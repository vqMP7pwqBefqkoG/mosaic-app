
import os
import json
import cv2
import numpy as np
import subprocess
import base64
import imageio
from PIL import Image, ImageDraw, ImageFont
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

def apply_mosaic_effect(image, shape_mask, effect_type, strength, feather_strength, fill_color=None, fill_opacity=None, emoji_char=None, shape=None):
    image_float = image.astype(float)

    # 1. Create the effect layer (applied to the whole image initially)
    if effect_type == 'emoji' and emoji_char and shape is not None:
        return _apply_emoji_effect(image, shape, emoji_char)
    elif effect_type == 'blur':
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


def _apply_emoji_effect(image, shape, emoji_char):
    """PillowでemojiをラスタライズしてOpenCVフレームに合成する"""
    h_img, w_img = image.shape[:2]

    # 形状の境界ボックスを計算 (クリッピング付き)
    shape_type = shape.get('type', 'rect')
    if shape_type in ['rect', 'rounded-rect']:
        sx = int(max(0, min(shape['x'], shape['x'] + shape['w'])))
        sy = int(max(0, min(shape['y'], shape['y'] + shape['h'])))
        sw = int(abs(shape['w']))
        sh = int(abs(shape['h']))
    else:  # ellipse
        sx = int(max(0, shape['cx'] - shape['rx']))
        sy = int(max(0, shape['cy'] - shape['ry']))
        sw = int(shape['rx'] * 2)
        sh = int(shape['ry'] * 2)

    # 境界チェック
    sx = max(0, min(sx, w_img - 1))
    sy = max(0, min(sy, h_img - 1))
    sw = max(1, min(sw, w_img - sx))
    sh = max(1, min(sh, h_img - sy))

    # 絵文字のフォントサイズ = 領域の短辺に合わせる
    font_size = int(min(sw, sh) * 0.85)
    if font_size < 8:
        return image  # 小さすぎる場合はスキップ

    # Pillowでemojiをレンダリング (RGBA)
    canvas_size = max(sw, sh) * 2  # 余白を持たせて描画
    pil_img = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(pil_img)

    # フォントの読み込み (Segoe UI Emoji優先)
    font = _load_emoji_font(font_size)

    # 絵文字を中央に描画
    try:
        bbox = draw.textbbox((0, 0), emoji_char, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        draw_x = (canvas_size - text_w) // 2 - bbox[0]
        draw_y = (canvas_size - text_h) // 2 - bbox[1]
        draw.text((draw_x, draw_y), emoji_char, font=font, embedded_color=True)
    except Exception:
        # フォールバック: fill='white'
        try:
            draw.text((canvas_size // 4, canvas_size // 4), emoji_char, font=font, fill='white')
        except Exception:
            return image

    # 絵文字画像を形状領域にリサイズ (アスペクト比維持)
    emoji_pil = pil_img.crop(pil_img.getbbox() or (0, 0, canvas_size, canvas_size))
    # アスペクト比を計算して sw x sh 内に収まるようにスケール
    ew, eh = emoji_pil.size
    if ew == 0 or eh == 0:
        return image
    scale = min(sw / ew, sh / eh)
    new_w = max(1, int(ew * scale))
    new_h = max(1, int(eh * scale))
    emoji_pil = emoji_pil.resize((new_w, new_h), Image.LANCZOS)

    # 中央配置オフセット
    offset_x = sx + (sw - new_w) // 2
    offset_y = sy + (sh - new_h) // 2

    # OpenCV(BGR)画像をPIL(RGB)に変換して合成
    output = image.copy()
    img_pil = Image.fromarray(cv2.cvtColor(output, cv2.COLOR_BGR2RGB)).convert('RGBA')
    img_pil.paste(emoji_pil, (offset_x, offset_y), emoji_pil)
    result_bgr = cv2.cvtColor(np.array(img_pil.convert('RGB')), cv2.COLOR_RGB2BGR)
    return result_bgr


_emoji_font_cache = {}

def _load_emoji_font(size):
    """絵文字フォントをキャッシュ付きで読み込む"""
    import os
    if size in _emoji_font_cache:
        return _emoji_font_cache[size]
    
    # Windowsの優先フォントパスリスト
    candidate_paths = [
        r'C:\Windows\Fonts\seguiemj.ttf',   # Segoe UI Emoji (Windows 10/11)
        r'C:\Windows\Fonts\seguisym.ttf',   # Segoe UI Symbol
        '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',  # Linux
        '/System/Library/Fonts/Apple Color Emoji.ttc',        # macOS
    ]
    font = None
    for path in candidate_paths:
        if os.path.exists(path):
            try:
                font = ImageFont.truetype(path, size)
                break
            except Exception:
                continue
    if font is None:
        try:
            font = ImageFont.load_default(size=size)
        except Exception:
            font = ImageFont.load_default()
    
    _emoji_font_cache[size] = font
    return font


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
        crop_x, crop_y = 0, 0
        if crop_data and crop_data.get('w', 0) > 0 and crop_data.get('h', 0) > 0:
            crop_x, crop_y = int(crop_data['x']), int(crop_data['y'])
            output_width = min(int(crop_data['w']), width - crop_x)
            output_height = min(int(crop_data['h']), height - crop_y)

        # Ensure width and height are even for x264 compatibility
        final_width = output_width - (output_width % 2)
        final_height = output_height - (output_height % 2)

        quality_slider_value = float(settings.get('quality', 5))
        crf_value = int(33 - (quality_slider_value * 1.5))

        command = [
            'ffmpeg', '-y',
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', f'{final_width}x{final_height}',
            '-pix_fmt', 'bgr24',
            '-r', str(fps),
            '-i', '-', # Pipe input
        ]

        if not is_webp:
            audio_ss = loop_start / fps
            audio_t = (loop_end - loop_start + 1) / fps
            command.extend(['-ss', str(audio_ss), '-t', str(audio_t), '-i', original_video_path]) # Audio source

        command.extend(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', str(crf_value), '-preset', 'medium'])

        if not is_webp:
            command.extend(['-c:a', 'aac', '-b:a', '128k', '-map', '0:v:0', '-map', '1:a:0?', '-shortest'])
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
                for i in range(start, end + 1):
                    ret, frame = c.read()
                    if not ret: break
                    yield i, frame
            frame_iterator = video_frame_generator(cap, loop_start, loop_end)

        for i, frame in frame_iterator:
            if i > loop_end: break
            
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

            # Crop frame to the final even dimensions.
            # This ensures the frame sent to FFmpeg matches the dimensions specified in the command.
            processed_frame = processed_frame[max(0, crop_y):crop_y+final_height, max(0, crop_x):crop_x+final_width]

            # Apply mosaic/blur effects if any shapes are present
            if shapes_to_apply:
                mask = np.zeros(processed_frame.shape[:2], dtype=np.uint8)
                emoji_shape_ref = None
                for shape in shapes_to_apply:
                    if shape['type'] in ['rect', 'rounded-rect']:
                        if shape['w'] != 0 and shape['h'] != 0:
                            if shape.get('rotation', 0) != 0:
                                cv2.drawContours(mask, [get_rotated_rect_corners(shape)], 0, 255, -1)
                            else:
                                draw_rounded_rect_mask(mask, shape)
                            if emoji_shape_ref is None:
                                emoji_shape_ref = shape
                    elif shape['type'] == 'ellipse':
                        if shape['rx'] != 0 and shape['ry'] != 0:
                            cv2.ellipse(mask, (int(shape['cx']), int(shape['cy'])), (int(shape['rx']), int(shape['ry'])), shape.get('rotation', 0) * 180 / np.pi, 0, 360, 255, -1)
                            if emoji_shape_ref is None:
                                emoji_shape_ref = shape
                
                processed_frame = apply_mosaic_effect(
                    processed_frame, mask, effect_type,
                    settings.get('mosaicStrength', 10), 0,
                    settings.get('fillColor'), settings.get('fillOpacity'),
                    emoji_char=settings.get('emojiChar'),
                    shape=emoji_shape_ref
                )

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
