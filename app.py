
import os
import json
import cv2
import numpy as np
import subprocess
import base64
import imageio
from flask import Flask, request, render_template, send_from_directory, jsonify

app = Flask(__name__)

# フォルダパスの設定
UPLOAD_FOLDER = 'uploads'
PROCESSED_FOLDER = 'processed'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['PROCESSED_FOLDER'] = PROCESSED_FOLDER

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(PROCESSED_FOLDER, exist_ok=True)

# --- ヘルパー関数 ---

def apply_mosaic_effect(image, shape_mask, effect_type, strength, feather_strength, fill_color=None, fill_opacity=None):
    image_float = image.astype(float)

    # 1. Create the effect layer (applied to the whole image initially)
    if effect_type == 'blur':
        ksize = int(strength) * 2 + 1
        effect_image = cv2.GaussianBlur(image_float, (ksize, ksize), 0)
    elif effect_type == 'block':
        h, w, _ = image.shape
        strength = int(strength)
        if strength <= 1: return image
        small = cv2.resize(image, (max(1, w // strength), max(1, h // strength)), interpolation=cv2.INTER_NEAREST)
        effect_image = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST).astype(float)
    elif effect_type == 'fill' and fill_color and fill_opacity is not None:
        hex_color = fill_color.lstrip('#')
        bgr_color = tuple(int(hex_color[i:i+2], 16) for i in (4, 2, 0))
        color_overlay = np.full(image.shape, bgr_color, dtype=float)
        opacity = float(fill_opacity)
        effect_image = cv2.addWeighted(color_overlay, opacity, image_float, 1 - opacity, 0)
    else: # No valid effect or 'image' effect (which is handled elsewhere)
        return image

    # 2. Feather the mask
    if feather_strength > 0:
        feather_ksize = int(feather_strength) * 2 + 1
        # Ensure the mask is 8-bit single channel before blurring
        if len(shape_mask.shape) == 3:
            shape_mask = cv2.cvtColor(shape_mask, cv2.COLOR_BGR2GRAY)
        blurred_mask = cv2.GaussianBlur(shape_mask, (feather_ksize, feather_ksize), 0)
    else:
        blurred_mask = shape_mask

    # 3. Normalize the mask to be used as an alpha channel
    alpha_mask = blurred_mask.astype(float) / 255.0
    alpha_mask = alpha_mask[:, :, np.newaxis] # Add channel dimension for broadcasting

    # 4. Blend the original image and the effect image using the alpha mask
    output_image = image_float * (1 - alpha_mask) + effect_image * alpha_mask
    
    return output_image.astype(np.uint8)

def draw_rounded_rect_mask(mask, shape):
    x, y, w, h, r = int(shape['x']), int(shape['y']), int(shape['w']), int(shape['h']), int(shape.get('borderRadius', 0))
    r = min(r, w // 2, h // 2)

    # Draw the four corners
    cv2.circle(mask, (x + r, y + r), r, 255, -1)
    cv2.circle(mask, (x + w - r, y + r), r, 255, -1)
    cv2.circle(mask, (x + r, y + h - r), r, 255, -1)
    cv2.circle(mask, (x + w - r, y + h - r), r, 255, -1)

    # Draw the three rectangles to fill the shape
    cv2.rectangle(mask, (x + r, y), (x + w - r, y + h), 255, -1)
    cv2.rectangle(mask, (x, y + r), (x + w, y + h - r), 255, -1)

    return mask

def get_interpolated_value(v1, v2, t):
    return v1 + (v2 - v1) * t

def get_rotated_rect_corners(shape):
    center = {'x': shape['x'] + shape['w'] / 2, 'y': shape['y'] + shape['h'] / 2}
    corners = [{'x': shape['x'], 'y': shape['y']}, {'x': shape['x'] + shape['w'], 'y': shape['y']}, {'x': shape['x'] + shape['w'], 'y': shape['y'] + shape['h']}, {'x': shape['x'], 'y': shape['y'] + shape['h']}]
    angle = shape['rotation']
    cos_a, sin_a = np.cos(angle), np.sin(angle)
    rotated_corners = []
    for p in corners:
        x_new = (p['x'] - center['x']) * cos_a - (p['y'] - center['y']) * sin_a + center['x']
        y_new = (p['x'] - center['x']) * sin_a + (p['y'] - center['y']) * cos_a + center['y']
        rotated_corners.append([int(x_new), int(y_new)])
    return np.array(rotated_corners, dtype=np.int32)

def _get_webp_fps(path):
    """Helper to calculate FPS from a WebP file."""
    try:
        with imageio.v2.get_reader(path) as reader:
            # Try to get global FPS first
            fps = reader.get_meta_data().get('fps')
            if fps:
                return fps

            # If not, calculate from average frame duration
            durations = [frame.meta.get('duration') for frame in reader]
            # Filter out None values
            durations = [d for d in durations if d is not None]

            if not durations:
                return 10 # Fallback

            avg_duration = sum(durations) / len(durations)

            if avg_duration == 0:
                return 10 # Avoid division by zero

            # Heuristic: if duration is > 1.0, it's likely in milliseconds.
            # Pillow plugin returns duration in ms.
            if avg_duration > 1.0:
                return 1000.0 / avg_duration
            # Other plugins might return seconds
            else:
                return 1.0 / avg_duration
    except Exception:
        return 10 # Final fallback

def clear_folder(folder_path):
    """Deletes all files in a given folder."""
    print(f"Clearing folder: {folder_path}")
    for filename in os.listdir(folder_path):
        file_path = os.path.join(folder_path, filename)
        try:
            if os.path.isfile(file_path) or os.path.islink(file_path):
                os.unlink(file_path)
        except Exception as e:
            print(f'Failed to delete {file_path}. Reason: {e}')

# --- Flask ルート ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/serve_temp_video/<filename>')
def serve_temp_video(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/get_video_info', methods=['POST'])
def get_video_info():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400

    video_file = request.files['video']
    is_webp = video_file.filename.lower().endswith('.webp')
    
    temp_filename = f"temp_info_{os.urandom(8).hex()}_{video_file.filename}"
    temp_video_path = os.path.join(app.config['UPLOAD_FOLDER'], temp_filename)
    
    try:
        video_file.save(temp_video_path)
        video_url = f"/serve_temp_video/{temp_filename}"

        if is_webp:
            fps = _get_webp_fps(temp_video_path)
            frames = imageio.v2.mimread(temp_video_path) # Read frames for writing
            if not frames:
                return jsonify({'error': 'Could not read webp file'}), 400

            temp_mp4_filename = f"temp_conv_{os.urandom(8).hex()}.mp4"
            temp_mp4_path = os.path.join(app.config['UPLOAD_FOLDER'], temp_mp4_filename)

            # Use original RGB frames for writing video to get correct colors
            imageio.v2.mimwrite(temp_mp4_path, frames, fps=fps, quality=8)

            # Now, use the converted mp4 for info gathering
            temp_video_path = temp_mp4_path
            video_url = f"/serve_temp_video/{temp_mp4_filename}"

        cap = cv2.VideoCapture(temp_video_path)
        if not cap.isOpened():
            return jsonify({'error': 'Could not open video file'}), 400
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = frame_count / fps if fps > 0 else 0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()

        return jsonify({
            'fps': fps,
            'frameCount': frame_count,
            'duration': duration,
            'width': width,
            'height': height,
            'video_url': video_url
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        # Don't delete the temp file yet, it's needed for preview
        pass


@app.route('/process_video', methods=['POST'])
def process_video():
    if 'video' not in request.files or 'settings' not in request.form:
        return jsonify({'error': 'Invalid request'}), 400

    video_file = request.files['video']
    original_filename = video_file.filename
    is_webp = original_filename.lower().endswith('.webp')
    base_filename = os.path.splitext(original_filename)[0]
    temp_id = os.urandom(8).hex()
    original_video_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{temp_id}_{original_filename}")
    final_output_path = os.path.join(app.config['PROCESSED_FOLDER'], f"final_{temp_id}_{base_filename}.mp4")

    proc = None
    cap = None
    webp_reader = None

    try:
        video_file.save(original_video_path)
        settings = json.loads(request.form['settings'])
        layers = settings['layers']
        effect_type = settings['effectType']
        
        start_frame = int(settings.get('startFrame') or -1)
        end_frame = int(settings.get('endFrame') or -1)

        if start_frame != -1 and end_frame != -1 and start_frame >= end_frame:
            return jsonify({'error': '終了フレームは開始フレームより後の必要があります。'}), 400

        # --- Get Video Metadata ---
        if is_webp:
            webp_reader = imageio.v2.get_reader(original_video_path)
            try:
                first_frame = webp_reader.get_data(0)
                height, width, _ = first_frame.shape
            except IndexError:
                return jsonify({'error': 'Cannot read first frame from WebP to determine size.'}), 500
            fps = _get_webp_fps(original_video_path)
            frame_count = len(webp_reader)
        else:
            cap = cv2.VideoCapture(original_video_path)
            if not cap.isOpened():
                raise IOError("Cannot open video file")
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        loop_start = start_frame if start_frame != -1 else 0
        loop_end = end_frame if end_frame != -1 else frame_count

        # --- Setup FFmpeg Process for Piping ---
        crop_data = settings.get('crop')
        output_width, output_height = width, height
        if crop_data and crop_data.get('w', 0) > 0 and crop_data.get('h', 0) > 0:
            x, y, w, h = int(crop_data['x']), int(crop_data['y']), int(crop_data['w']), int(crop_data['h'])
            output_width = min(w, width - x)
            output_height = min(h, height - y)

        quality_slider_value = float(settings.get('quality', 5))
        crf_value = int(33 - (quality_slider_value * 1.5))

        command = [
            'ffmpeg', '-y',
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', f'{output_width}x{output_height}',
            '-pix_fmt', 'bgr24',
            '-r', str(fps),
            '-i', '-', # Pipe input
        ]

        if not is_webp:
            command.extend(['-i', original_video_path]) # Audio source

        command.extend(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', str(crf_value), '-preset', 'medium'])

        if not is_webp:
            command.extend(['-c:a', 'aac', '-b:a', '128k', '-map', '0:v:0', '-map', '1:a:0?'])
        else:
            command.extend(['-an'])
        
        command.append(final_output_path)

        proc = subprocess.Popen(command, stdin=subprocess.PIPE)

        # --- Main Processing Loop (Streaming to FFmpeg) ---
        frame_iterator = None
        if is_webp:
            frame_iterator = enumerate(webp_reader)
        else:
            cap.set(cv2.CAP_PROP_POS_FRAMES, loop_start)
            def video_frame_generator(c, start, end):
                for i in range(start, end):
                    ret, frame = c.read()
                    if not ret: break
                    yield i, frame
            frame_iterator = video_frame_generator(cap, loop_start, loop_end)

        for i, frame in frame_iterator:
            if i >= loop_end: break
            
            if is_webp and frame.shape[2] == 4:
                frame = cv2.cvtColor(frame, cv2.COLOR_RGBA2BGR)
            
            # --- Apply Effects (Frame by Frame) ---
            processed_frame = frame
            
            # Get shapes for the current frame (including interpolated ones)
            shapes_to_apply = []
            for layer in layers:
                kf_data = layer['keyframes']
                kf_frames = sorted([int(f) for f in kf_data.keys()])
                if str(i) in kf_data and kf_data[str(i)]:
                    shapes_to_apply.extend(kf_data[str(i)])
                else:
                    prev_kf_frame = next((f for f in reversed(kf_frames) if f < i), None)
                    next_kf_frame = next((f for f in kf_frames if f > i), None)
                    if prev_kf_frame is not None and next_kf_frame is not None:
                        s1_list, s2_list = kf_data.get(str(prev_kf_frame)), kf_data.get(str(next_kf_frame))
                        if s1_list and s2_list:
                            s1, s2 = s1_list[0], s2_list[0]
                            if s1['type'] == s2['type']:
                                t = (i - prev_kf_frame) / (next_kf_frame - prev_kf_frame)
                                interp_shape = {'type': s1['type'], 'rotation': get_interpolated_value(s1.get('rotation', 0), s2.get('rotation', 0), t)}
                                if s1['type'] in ['rect', 'rounded-rect']:
                                    interp_shape.update({'x': get_interpolated_value(s1['x'], s2['x'], t), 'y': get_interpolated_value(s1['y'], s2['y'], t), 'w': get_interpolated_value(s1['w'], s2['w'], t), 'h': get_interpolated_value(s1['h'], s2['h'], t), 'borderRadius': get_interpolated_value(s1.get('borderRadius', 0), s2.get('borderRadius', 0), t)})
                                else:
                                    interp_shape.update({'cx': get_interpolated_value(s1['cx'], s2['cx'], t), 'cy': get_interpolated_value(s1['cy'], s2['cy'], t), 'rx': get_interpolated_value(s1['rx'], s2['rx'], t), 'ry': get_interpolated_value(s1['ry'], s2['ry'], t)})
                                shapes_to_apply.append(interp_shape)

            # Crop frame
            if crop_data and crop_data.get('w', 0) > 0 and crop_data.get('h', 0) > 0:
                cx, cy, cw, ch = int(crop_data['x']), int(crop_data['y']), int(crop_data['w']), int(crop_data['h'])
                processed_frame = processed_frame[max(0, cy):cy+ch, max(0, cx):cx+cw]

            # Apply mosaic/blur effects if any shapes are present
            if shapes_to_apply:
                mask = np.zeros(processed_frame.shape[:2], dtype=np.uint8)
                for shape in shapes_to_apply:
                    if shape['type'] in ['rect', 'rounded-rect']:
                        if shape['w'] != 0 and shape['h'] != 0:
                            if shape.get('rotation', 0) != 0:
                                cv2.drawContours(mask, [get_rotated_rect_corners(shape)], 0, 255, -1)
                            else:
                                draw_rounded_rect_mask(mask, shape)
                    elif shape['type'] == 'ellipse':
                        if shape['rx'] != 0 and shape['ry'] != 0:
                            cv2.ellipse(mask, (int(shape['cx']), int(shape['cy'])), (int(shape['rx']), int(shape['ry'])), shape.get('rotation', 0) * 180 / np.pi, 0, 360, 255, -1)
                
                processed_frame = apply_mosaic_effect(processed_frame, mask, effect_type, settings.get('mosaicStrength', 10), 0, settings.get('fillColor'), settings.get('fillOpacity'))

            proc.stdin.write(processed_frame.tobytes())

        # --- Finalize Video ---
        proc.stdin.close()
        proc.wait()
        if proc.returncode != 0:
            raise Exception("FFmpeg Error: Check the server terminal for detailed logs.")

        return jsonify({'download_url': f'/download/{os.path.basename(final_output_path)}'})

    except Exception as e:
        if proc: proc.kill()
        import traceback
        traceback.print_exc()
        return jsonify({'error': f"An unexpected error occurred: {str(e)}"}), 500
    finally:
        if cap and cap.isOpened(): cap.release()
        if webp_reader: webp_reader.close()
        if os.path.exists(original_video_path): os.remove(original_video_path)


@app.route('/download/<filename>')
def download_file(filename):
    return send_from_directory(app.config['PROCESSED_FOLDER'], filename, as_attachment=True)

@app.route('/clear_processed_folder', methods=['POST'])
def clear_processed_folder():
    """Endpoint to manually clear all files from the processed folder."""
    try:
        clear_folder(app.config['PROCESSED_FOLDER'])
        return jsonify({'status': 'success', 'message': '「processed」フォルダを空にしました。'}), 200
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    # Clear the uploads folder on startup
    clear_folder(app.config['UPLOAD_FOLDER'])
    app.run(host='0.0.0.0', port=5001, debug=True)
