document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const canvasOverlay = document.getElementById('canvas-overlay');
    const videoUpload = document.getElementById('video-upload');
    const videoPreview = document.getElementById('video-preview');
    const deleteKeyframeButton = document.getElementById('delete-keyframe-button');
    const keyframesList = document.getElementById('keyframes-list');
    const layersList = document.getElementById('layers-list');
    const addLayerButton = document.getElementById('add-layer-button');
    const deleteLayerButton = document.getElementById('delete-layer-button');
    const timeline = document.getElementById('timeline');
    const currentFrameElem = document.getElementById('current-frame');
    const totalFramesElem = document.getElementById('total-frames');
    const playPauseButton = document.getElementById('play-pause-button');
    const prevFrameButton = document.getElementById('prev-frame-button');
    const nextFrameButton = document.getElementById('next-frame-button');
    const startButton = document.getElementById('start-button');
    const endButton = document.getElementById('end-button');
    const deleteStartInput = document.getElementById('delete-start');
    const deleteEndInput = document.getElementById('delete-end');
    const setDeleteStartButton = document.getElementById('set-delete-start-button');
    const setDeleteEndButton = document.getElementById('set-delete-end-button');
    const shapeRoundedRectRadio = document.getElementById('shape-rounded-rect');
    const shapeEllipseRadio = document.getElementById('shape-ellipse');

    const processButton = document.getElementById('process-button');
    const statusDiv = document.getElementById('status');
    const effectTypeSelect = document.getElementById('effect-type');
    const mosaicStrengthSlider = document.getElementById('mosaic-strength');
    const strengthSetting = document.getElementById('strength-setting');
    const radiusSetting = document.getElementById('radius-setting');
    const borderRadiusSlider = document.getElementById('border-radius-slider');
    const colorSetting = document.getElementById('color-setting');
    const fillColorInput = document.getElementById('fill-color');
    const fillOpacitySlider = document.getElementById('fill-opacity');
    const modeShapesRadio = document.getElementById('mode-shapes');
    const modeCropRadio = document.getElementById('mode-crop');
    const cropInputs = document.getElementById('crop-inputs');
    const cropXInput = document.getElementById('crop-x');
    const cropYInput = document.getElementById('crop-y');
    const cropWInput = document.getElementById('crop-w');
    const cropHInput = document.getElementById('crop-h');
    const imageSetting = document.getElementById('image-setting');
    const imageUpload = document.getElementById('image-upload');
    const opacitySetting = document.getElementById('opacity-setting');
    const shapeEditor = document.getElementById('selected-keyframe-editor');
    const rectInputs = document.getElementById('rect-inputs');
    const ellipseInputs = document.getElementById('ellipse-inputs');
    const shapeInputs = {
        x: document.getElementById('shape-x'),
        y: document.getElementById('shape-y'),
        w: document.getElementById('shape-w'),
        h: document.getElementById('shape-h'),
        cx: document.getElementById('shape-cx'),
        cy: document.getElementById('shape-cy'),
        rx: document.getElementById('shape-rx'),
        ry: document.getElementById('shape-ry'),
        rotation: document.getElementById('shape-rotation')
    };
    const addKeyframeFromValuesButton = document.getElementById('add-keyframe-from-values-button');
    const exportSettingsButton = document.getElementById('export-settings-button');
    const importSettingsInput = document.getElementById('import-settings-input');
    const clearProcessedButton = document.getElementById('clear-processed-button');

    const toggleQualitySettingsButton = document.getElementById('toggle-quality-settings');
    const qualitySettingsDiv = document.getElementById('quality-settings');
    const qualitySlider = document.getElementById('quality-slider');

    // --- State Variables ---
    let videoFile = null;
    let drawingShape = 'rounded-rect';
    let videoDuration = 0, totalFrameCount = 0, currentFrame = 0, videoFps = 30, lastFrameIndex = 0;
    let editMode = 'shapes';
    let cropRect = null;
    let layers = [];
    let nextLayerId = 1;
    let selectedLayerId = null;
    let nextKeyframeId = 0;
    let selectedKeyframeId = null;
    let isDrawing = false, isMoving = false, isResizing = false, isRotating = false, isCropping = false;
    let resizeHandle = null;
    let startX, startY;
    let currentShape = {};
    let fillImage = null;
    let fillImageSrc = null;
    const ctx = canvasOverlay.getContext('2d');
    const handleSize = 16;
    let animationFrameId = null;

    let isRenderPlaying = false;

    // --- Logic ---

    function getSelectedLayer() {
        return layers.find(l => l.id === selectedLayerId);
    }

    function getSelectedKeyframe() {
        const layer = getSelectedLayer();
        if (!layer) return null;
        const frameKfs = layer.keyframes[currentFrame];
        if (!frameKfs) return null;
        return frameKfs.find(kf => kf.id === selectedKeyframeId);
    }

    function getShapeCenter(shape) {
        if (shape.type === 'rect' || shape.type === 'rounded-rect') {
            return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
        } else {
            return { x: shape.cx, y: shape.cy };
        }
    }

    function getRotatedPoint(point, center, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        return {
            x: dx * cos - dy * sin + center.x,
            y: dx * sin + dy * cos + center.y
        };
    }

    function getPointInShape(point, shape) {
        const center = getShapeCenter(shape);
        const localPoint = getRotatedPoint(point, center, -(shape.rotation || 0));
        if (shape.type === 'rect' || shape.type === 'rounded-rect') {
            const x = shape.w > 0 ? shape.x : shape.x + shape.w;
            const y = shape.h > 0 ? shape.y : shape.y + shape.h;
            const w = Math.abs(shape.w);
            const h = Math.abs(shape.h);
            return localPoint.x >= x && localPoint.x <= x + w && localPoint.y >= y && localPoint.y <= y + h;
        } else { // ellipse
            const dx = localPoint.x - shape.cx;
            const dy = localPoint.y - shape.cy;
            return (dx * dx) / (shape.rx * shape.rx) + (dy * dy) / (shape.ry * shape.ry) <= 1;
        }
    }

    function getHandles(shape) {
        const center = getShapeCenter(shape);
        const angle = shape.rotation || 0;
        let points = {};
        if (shape.type === 'rect' || shape.type === 'rounded-rect') {
            points = { topLeft: { x: shape.x, y: shape.y }, topRight: { x: shape.x + shape.w, y: shape.y }, bottomLeft: { x: shape.x, y: shape.y + shape.h }, bottomRight: { x: shape.x + shape.w, y: shape.y + shape.h } };
        } else { // ellipse
            points = { top: { x: shape.cx, y: shape.cy - shape.ry }, bottom: { x: shape.cx, y: shape.cy + shape.ry }, left: { x: shape.cx - shape.rx, y: shape.cy }, right: { x: shape.cx + shape.rx, y: shape.cy } };
        }
        const rotatedHandles = {};
        for (const name in points) {
            rotatedHandles[name] = getRotatedPoint(points[name], center, angle);
        }
        return rotatedHandles;
    }

    function drawHandles(shape) {
        const handles = getHandles(shape);
        ctx.fillStyle = 'blue';
        for (const name in handles) {
            const pos = handles[name];
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, handleSize / 2, 0, 2 * Math.PI);
            ctx.fill();
        }
        const center = getShapeCenter(shape);
        const angle = shape.rotation || 0;
        const shapeW = shape.type === 'rect' || shape.type === 'rounded-rect' ? shape.w : shape.rx * 2;
        const shapeH = shape.type === 'rect' || shape.type === 'rounded-rect' ? shape.h : shape.ry * 2;
        const distanceToCorner = Math.hypot(shapeW / 2, shapeH / 2);
        const dynamicOffset = distanceToCorner + 20;
        const rotHandleX = center.x + Math.sin(angle) * dynamicOffset;
        const rotHandleY = center.y - Math.cos(angle) * dynamicOffset;
        ctx.fillStyle = 'green';
        ctx.beginPath();
        ctx.arc(rotHandleX, rotHandleY, handleSize / 2, 0, 2 * Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(rotHandleX, rotHandleY);
        ctx.strokeStyle = 'green';
        ctx.stroke();
    }

    function getHandleAtPos(pos) {
        const kf = getSelectedKeyframe();
        if (!kf) return null;
        const center = getShapeCenter(kf);
        const angle = kf.rotation || 0;
        const shapeW = kf.type === 'rect' || kf.type === 'rounded-rect' ? kf.w : kf.rx * 2;
        const shapeH = kf.type === 'rect' || kf.type === 'rounded-rect' ? kf.h : kf.ry * 2;
        const distanceToCorner = Math.hypot(shapeW / 2, shapeH / 2);
        const dynamicOffset = distanceToCorner + 20;
        const rotHandleX = center.x + Math.sin(angle) * dynamicOffset;
        const rotHandleY = center.y - Math.cos(angle) * dynamicOffset;
        if (Math.hypot(pos.x - rotHandleX, pos.y - rotHandleY) <= handleSize) {
            return 'rotation';
        }
        const handles = getHandles(kf);
        for (const handleName in handles) {
            const handlePos = handles[handleName];
            if (Math.hypot(pos.x - handlePos.x, pos.y - handlePos.y) <= handleSize) {
                return handleName;
            }
        }
        return null;
    }

    function applyEffectPreview(shape) {
        const center = getShapeCenter(shape);
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.rotate(shape.rotation || 0);
        ctx.translate(-center.x, -center.y);
        ctx.beginPath();
        if (shape.type === 'rect') { ctx.rect(shape.x, shape.y, shape.w, shape.h); } 
        else if (shape.type === 'rounded-rect') {
            const r = shape.borderRadius || 0;
            ctx.moveTo(shape.x + r, shape.y);
            ctx.lineTo(shape.x + shape.w - r, shape.y);
            ctx.arcTo(shape.x + shape.w, shape.y, shape.x + shape.w, shape.y + r, r);
            ctx.lineTo(shape.x + shape.w, shape.y + shape.h - r);
            ctx.arcTo(shape.x + shape.w, shape.y + shape.h, shape.x + shape.w - r, shape.y + shape.h, r);
            ctx.lineTo(shape.x + r, shape.y + shape.h);
            ctx.arcTo(shape.x, shape.y + shape.h, shape.x, shape.y + shape.h - r, r);
            ctx.lineTo(shape.x, shape.y + r);
            ctx.arcTo(shape.x, shape.y, shape.x + r, shape.y, r);
            ctx.closePath();
        }
        else { ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, 2 * Math.PI); }
        ctx.clip();
        const effectType = effectTypeSelect.value;
        if (effectType === 'fill') {
            const hexColor = fillColorInput.value;
            const opacity = fillOpacitySlider.value;
            const r = parseInt(hexColor.slice(1, 3), 16);
            const g = parseInt(hexColor.slice(3, 5), 16);
            const b = parseInt(hexColor.slice(5, 7), 16);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
            ctx.fill();
        } else if (effectType === 'image' && fillImage) {
            const shapeW = (shape.type === 'rect' || shape.type === 'rounded-rect') ? shape.w : shape.rx * 2;
            const shapeH = (shape.type === 'rect' || shape.type === 'rounded-rect') ? shape.h : shape.ry * 2;
            const shapeX = (shape.type === 'rect' || shape.type === 'rounded-rect') ? shape.x : shape.cx - shape.rx;
            const shapeY = (shape.type === 'rect' || shape.type === 'rounded-rect') ? shape.y : shape.cy - shape.ry;
            const imgRatio = fillImage.width / fillImage.height;
            const shapeRatio = shapeW / shapeH;
            let drawW, drawH, drawX, drawY;
            if (imgRatio > shapeRatio) { drawW = shapeW; drawH = shapeW / imgRatio; }
            else { drawH = shapeH; drawW = shapeH * imgRatio; }
            drawX = shapeX + (shapeW - drawW) / 2;
            drawY = shapeY + (shapeH - drawH) / 2;
            ctx.globalAlpha = fillOpacitySlider.value;
            ctx.drawImage(fillImage, drawX, drawY, drawW, drawH);
        } else {
            const strength = parseInt(mosaicStrengthSlider.value, 10);
            if (videoPreview.readyState >= 2) {
                // Undo the rotation of the context so the effect pattern is not rotated
                ctx.translate(center.x, center.y);
                ctx.rotate(-(shape.rotation || 0));
                ctx.translate(-center.x, -center.y);

                if (effectType === 'blur' && strength > 0) {
                    ctx.filter = `blur(${strength / 2}px)`;
                    ctx.drawImage(videoPreview, 0, 0, canvasOverlay.width, canvasOverlay.height);
                } else if (effectType === 'block' && strength > 1) {
                    const tempCanvas = document.createElement('canvas');
                    const tempCtx = tempCanvas.getContext('2d');
                    const w = canvasOverlay.width; const h = canvasOverlay.height;
                    tempCanvas.width = w; tempCanvas.height = h;
                    tempCtx.imageSmoothingEnabled = false;
                    tempCtx.drawImage(videoPreview, 0, 0, w, h, 0, 0, w / strength, h / strength);
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(tempCanvas, 0, 0, w / strength, h / strength, 0, 0, w, h);
                } else {
                    ctx.drawImage(videoPreview, 0, 0, canvasOverlay.width, canvasOverlay.height);
                }
            }
        }
        ctx.restore();
    }

    function getSurroundingKeyframes(layer, frame) {
        const kfFrames = Object.keys(layer.keyframes).map(Number).sort((a, b) => a - b);
        let prevFrame = null;
        let nextFrame = null;
        for (const kfFrame of kfFrames) {
            if (kfFrame < frame) {
                prevFrame = kfFrame;
            } else if (kfFrame > frame) {
                nextFrame = kfFrame;
                break;
            }
        }
        return { prevFrame, nextFrame };
    }

    function getInterpolatedShape(layer, frame) {
        if (layer.keyframes[frame]) return null; // Don't interpolate if a keyframe exists

        const { prevFrame, nextFrame } = getSurroundingKeyframes(layer, frame);
        if (prevFrame === null || nextFrame === null) return null;

        const s1 = layer.keyframes[prevFrame]?.[0];
        const s2 = layer.keyframes[nextFrame]?.[0];

        if (s1 && s2 && s1.type === s2.type) {
            const t = (frame - prevFrame) / (nextFrame - prevFrame);
            const getInterpValue = (v1, v2) => v1 + (v2 - v1) * t;
            const interpShape = { type: s1.type, rotation: getInterpValue(s1.rotation || 0, s2.rotation || 0) };

            if (s1.type === 'rect' || s1.type === 'rounded-rect') {
                interpShape.x = getInterpValue(s1.x, s2.x);
                interpShape.y = getInterpValue(s1.y, s2.y);
                interpShape.w = getInterpValue(s1.w, s2.w);
                interpShape.h = getInterpValue(s1.h, s2.h);
                if (s1.type === 'rounded-rect') {
                    interpShape.borderRadius = getInterpValue(s1.borderRadius || 0, s2.borderRadius || 0);
                }
            } else {
                interpShape.cx = getInterpValue(s1.cx, s2.cx);
                interpShape.cy = getInterpValue(s1.cy, s2.cy);
                interpShape.rx = getInterpValue(s1.rx, s2.rx);
                interpShape.ry = getInterpValue(s1.ry, s2.ry);
            }
            return interpShape;
        }
        return null;
    }

    function drawCanvas() {
        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        if (videoPreview.readyState >= 2) {
            ctx.drawImage(videoPreview, 0, 0, canvasOverlay.width, canvasOverlay.height);
        }

        layers.forEach(layer => {
            const isSelectedLayer = layer.id === selectedLayerId;
            let shapesToDisplay = [];
            let isInterpolated = false;

            if (layer.keyframes[currentFrame]) {
                shapesToDisplay = layer.keyframes[currentFrame];
            } else {
                const interpShape = getInterpolatedShape(layer, currentFrame);
                if (interpShape) {
                    shapesToDisplay.push(interpShape);
                    isInterpolated = true;
                }
            }
            
            shapesToDisplay.forEach(shape => {
                applyEffectPreview(shape);
            });

            if (isSelectedLayer) {
                const { prevFrame, nextFrame } = getSurroundingKeyframes(layer, currentFrame);
                if (prevFrame !== null && nextFrame !== null) {
                    const s1 = layer.keyframes[prevFrame]?.[0];
                    const s2 = layer.keyframes[nextFrame]?.[0];
                    if (s1 && s2) {
                        const center1 = getShapeCenter(s1);
                        const center2 = getShapeCenter(s2);
                        ctx.beginPath(); ctx.moveTo(center1.x, center1.y); ctx.lineTo(center2.x, center2.y);
                        ctx.strokeStyle = 'rgba(0, 255, 0, 0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]);
                    }
                }
            }

            shapesToDisplay.forEach(shape => {
                const isSelectedKeyframe = isSelectedLayer && shape.id === selectedKeyframeId;
                const center = getShapeCenter(shape);
                ctx.save();
                ctx.translate(center.x, center.y);
                ctx.rotate(shape.rotation || 0);
                ctx.translate(-center.x, -center.y);
                if (isInterpolated) { 
                    ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
                } else {
                    ctx.strokeStyle = isSelectedKeyframe ? 'blue' : (isSelectedLayer ? 'red' : 'gray');
                    ctx.lineWidth = isSelectedKeyframe ? 2 : 1;
                    ctx.setLineDash([]);
                }
                if (shape.type === 'rect') { ctx.strokeRect(shape.x, shape.y, shape.w, shape.h); } 
                else if (shape.type === 'rounded-rect') {
                    const r = shape.borderRadius || 0;
                    ctx.beginPath();
                    ctx.moveTo(shape.x + r, shape.y);
                    ctx.lineTo(shape.x + shape.w - r, shape.y);
                    ctx.arcTo(shape.x + shape.w, shape.y, shape.x + shape.w, shape.y + r, r);
                    ctx.lineTo(shape.x + shape.w, shape.y + shape.h - r);
                    ctx.arcTo(shape.x + shape.w, shape.y + shape.h, shape.x + shape.w - r, shape.y + shape.h, r);
                    ctx.lineTo(shape.x + r, shape.y + shape.h);
                    ctx.arcTo(shape.x, shape.y + shape.h, shape.x, shape.y + shape.h - r, r);
                    ctx.lineTo(shape.x, shape.y + r);
                    ctx.arcTo(shape.x, shape.y, shape.x + r, shape.y, r);
                    ctx.closePath();
                    ctx.stroke();
                }
                else { ctx.beginPath(); ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, 2 * Math.PI); ctx.stroke(); }
                ctx.restore(); ctx.setLineDash([]);
                if (isSelectedKeyframe) { drawHandles(shape); }
            });
        });
        if (isDrawing && Object.keys(currentShape).length > 1) {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'; ctx.strokeStyle = 'red'; ctx.lineWidth = 1;
            if (currentShape.type === 'rect' || currentShape.type === 'rounded-rect') {
                const x = currentShape.w > 0 ? currentShape.x : currentShape.x + currentShape.w;
                const y = currentShape.h > 0 ? currentShape.y : currentShape.y + currentShape.h;
                ctx.fillRect(x, y, Math.abs(currentShape.w), Math.abs(currentShape.h));
                ctx.strokeRect(x, y, Math.abs(currentShape.w), Math.abs(currentShape.h));
            } else if (currentShape.type === 'ellipse') {
                ctx.beginPath(); ctx.ellipse(currentShape.cx, currentShape.cy, currentShape.rx, currentShape.ry, 0, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
            }
        }
        if (cropRect) {
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)'; ctx.lineWidth = 2; ctx.setLineDash([10, 5]);
            const x = cropRect.w < 0 ? cropRect.x + cropRect.w : cropRect.x;
            const y = cropRect.h < 0 ? cropRect.y + cropRect.h : cropRect.y;
            ctx.strokeRect(x, y, Math.abs(cropRect.w), Math.abs(cropRect.h));
            ctx.setLineDash([]);
        }
    }

    function finalizeAndAddShape(shape) {
        const layer = getSelectedLayer();
        // If the shape has no width/height (i.e. it was just a click), do not add it.
        if (!layer || !shape.w || !shape.h || shape.w === 0 || shape.h === 0) {
            return {}; // Return an empty object to clear currentShape
        }

        const shapeToAdd = { ...shape };
        if (shapeToAdd.type === 'rect' || shapeToAdd.type === 'rounded-rect') {
            if (shapeToAdd.w < 0) { shapeToAdd.x += shapeToAdd.w; shapeToAdd.w = -shapeToAdd.w; }
            if (shapeToAdd.h < 0) { shapeToAdd.y += shapeToAdd.h; shapeToAdd.h = -shapeToAdd.h; }
        }

        const newKeyframe = { id: nextKeyframeId++, rotation: 0, ...shapeToAdd };
        layer.keyframes[currentFrame] = [newKeyframe];
        selectedKeyframeId = newKeyframe.id;

        // Store the radius of the new shape for inheritance
        if (newKeyframe.type === 'rounded-rect') {
            layer.lastUsedRadius = newKeyframe.borderRadius;
        }

        updateKeyframesList();
        updateShapeEditor();
        return {};
    }

    function getEventPos(e) {
        const rect = canvasOverlay.getBoundingClientRect();
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; } 
        else if (e.changedTouches && e.changedTouches.length > 0) { clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY; }
        else { clientX = e.clientX; clientY = e.clientY; }
        return { x: (clientX - rect.left) * (canvasOverlay.width / rect.width), y: (clientY - rect.top) * (canvasOverlay.height / rect.height) };
    }

    function handleDragStart(e) {
        if (e.type === 'touchstart') e.preventDefault();
        if (isRenderPlaying) {
            isRenderPlaying = false;
            updatePlayPauseIcon(false); // Bug fix: Use helper to update icon
        }
        videoPreview.pause();
        const pos = getEventPos(e);
        startX = pos.x;
        startY = pos.y;

        // Add window-level listeners to track drag outside the canvas
        window.addEventListener('mousemove', handleDragMove);
        window.addEventListener('touchmove', handleDragMove, { passive: false });
        window.addEventListener('mouseup', handleDragEnd);
        window.addEventListener('touchend', handleDragEnd);

        if (editMode === 'crop') {
            isCropping = true;
            isDrawing = isMoving = isResizing = isRotating = false;
            cropRect = { x: startX, y: startY, w: 0, h: 0 };
            return;
        }
        const layer = getSelectedLayer();
        if (!layer) return;

        // Priority 1: Check for handles on an existing, selected keyframe
        const handle = getHandleAtPos(pos);
        if (handle) {
            if (handle === 'rotation') { isRotating = true; } else { isResizing = true; resizeHandle = handle; }
            isMoving = isDrawing = false;
            return; // Found a handle, action is set
        }

        // Priority 2: Check for a click inside an existing keyframe on the current frame
        const frameKeyframes = layer.keyframes[currentFrame] || [];
        for (let i = frameKeyframes.length - 1; i >= 0; i--) {
            if (getPointInShape(pos, frameKeyframes[i])) {
                selectedKeyframeId = frameKeyframes[i].id;
                isMoving = true;
                isDrawing = isResizing = isRotating = false;
                updateKeyframesList();
                updateShapeEditor();
                return; // Found a keyframe to move, action is set
            }
        }

        // Priority 3: Check for a click inside an interpolated shape
        const interpolatedShape = getInterpolatedShape(layer, currentFrame);
        if (interpolatedShape && getPointInShape(pos, interpolatedShape)) {
            // It's a hit! Create a new keyframe from the interpolated shape.
            const newKeyframe = { id: nextKeyframeId++, ...interpolatedShape };
            layer.keyframes[currentFrame] = [newKeyframe];
            selectedKeyframeId = newKeyframe.id;
            
            // Now, check if the click was on a handle of this *new* keyframe
            const newHandle = getHandleAtPos(pos);
            if (newHandle) {
                if (newHandle === 'rotation') { isRotating = true; } else { isResizing = true; resizeHandle = newHandle; }
                isMoving = isDrawing = false;
            } else {
                // If not on a handle, it's a move operation
                isMoving = true;
                isDrawing = isResizing = isRotating = false;
            }
            updateKeyframesList();
            updateShapeEditor();
            return; // Action is set
        }

        // Priority 4: If nothing else was hit, start drawing a new shape
        selectedKeyframeId = null;
        isDrawing = true;
        isMoving = isResizing = isRotating = false;
        currentShape = { type: drawingShape, rotation: 0 };
        if (drawingShape === 'rounded-rect') {
            const layer = getSelectedLayer();
            // Inherit last used radius for this layer, or default to 0
            currentShape.borderRadius = (layer && layer.lastUsedRadius) ? layer.lastUsedRadius : 0;
        }
        updateKeyframesList();
        updateShapeEditor();
    }

    function handleDragMove(e) {
        if (e.type === 'touchmove') e.preventDefault();
        let pos = getEventPos(e);

        if (isCropping) {
            cropRect.w = pos.x - startX;
            cropRect.h = pos.y - startY;
            updateCropInputs();
            return;
        }
        if (!isDrawing && !isMoving && !isResizing && !isRotating) return;
        const kf = getSelectedKeyframe();
        if (isRotating && kf) { const center = getShapeCenter(kf); kf.rotation = Math.atan2(pos.x - center.x, -(pos.y - center.y)); }
        else if (isResizing && kf) { 
            const center = getShapeCenter(kf); 
            const localPos = getRotatedPoint(pos, center, -(kf.rotation || 0)); 
            if (kf.type === 'rect' || kf.type === 'rounded-rect') { 
                const oldX = kf.x, oldY = kf.y, oldW = kf.w, oldH = kf.h; 
                switch (resizeHandle) { 
                    case 'topLeft': kf.x = localPos.x; kf.y = localPos.y; kf.w = oldW + (oldX - localPos.x); kf.h = oldH + (oldY - localPos.y); break; 
                    case 'topRight': kf.y = localPos.y; kf.w = localPos.x - oldX; kf.h = oldH + (oldY - localPos.y); break; 
                    case 'bottomLeft': kf.x = localPos.x; kf.w = oldW + (oldX - localPos.x); kf.h = localPos.y - oldY; break; 
                    case 'bottomRight': kf.w = localPos.x - oldX; kf.h = localPos.y - oldY; break; 
                } 
                if (kf.type === 'rounded-rect') {
                    const maxRadius = Math.min(Math.abs(kf.w), Math.abs(kf.h)) / 2;
                    borderRadiusSlider.max = maxRadius > 0 ? maxRadius : 1;
                    if (kf.borderRadius > maxRadius) {
                        kf.borderRadius = maxRadius;
                        borderRadiusSlider.value = maxRadius;
                    }
                }
            } else if (kf.type === 'ellipse') { 
                switch (resizeHandle) { 
                    case 'top': kf.ry = Math.abs(localPos.y - kf.cy); break; 
                    case 'bottom': kf.ry = Math.abs(localPos.y - kf.cy); break; 
                    case 'left': kf.rx = Math.abs(localPos.x - kf.cx); break; 
                    case 'right': kf.rx = Math.abs(localPos.x - kf.cx); break; 
                } 
            } 
        }
        else if (isMoving && kf) { const dx = pos.x - startX; const dy = pos.y - startY; if (kf.type === 'rect' || kf.type === 'rounded-rect') { kf.x += dx; kf.y += dy; } else if (kf.type === 'ellipse') { kf.cx += dx; kf.cy += dy; } startX = pos.x; startY = pos.y; }
        else if (isDrawing) { if (drawingShape === 'rect' || drawingShape === 'rounded-rect') { currentShape = { ...currentShape, x: startX, y: startY, w: pos.x - startX, h: pos.y - startY }; } else if (drawingShape === 'ellipse') { currentShape = { ...currentShape, cx: startX, cy: startY, rx: Math.abs(pos.x - startX), ry: Math.abs(pos.y - startY) }; } }
        updateShapeEditor();
    }

    function handleDragEnd(e) {
        if (e.type === 'touchend') e.preventDefault();

        // Clean up window-level listeners
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchend', handleDragEnd);

        if (isDrawing) {
            currentShape = finalizeAndAddShape(currentShape);
        }
        if (isCropping) {
            if (cropRect && cropRect.w < 0) { cropRect.x += cropRect.w; cropRect.w = -cropRect.w; }
            if (cropRect && cropRect.h < 0) { cropRect.y += cropRect.h; cropRect.h = -cropRect.h; }
            updateCropInputs();
        }
        if (isResizing) { 
            const kf = getSelectedKeyframe(); 
            if (kf && (kf.type === 'rect' || kf.type === 'rounded-rect')) { 
                if (kf.w < 0) { kf.x += kf.w; kf.w = -kf.w; } 
                if (kf.h < 0) { kf.y += kf.h; kf.h = -kf.h; } 
            } 
        } 
        isDrawing = isMoving = isResizing = isRotating = isCropping = false;
        resizeHandle = null;
        updateKeyframesList();
        updateShapeEditor();
    }

    function updateKeyframesList() {
        keyframesList.innerHTML = '';
        const layer = getSelectedLayer();
        if (!layer) return;
        const sortedFrames = Object.keys(layer.keyframes).map(Number).sort((a, b) => a - b);
        sortedFrames.forEach(frame => {
            layer.keyframes[frame].forEach(kf => {
                const li = document.createElement('li');
                li.textContent = `フレーム ${frame}: ${kf.type} (ID: ${kf.id})`;
                if (kf.id === selectedKeyframeId && parseInt(frame, 10) === currentFrame) {
                    li.classList.add('selected');
                }
                li.addEventListener('click', () => {
                    seekToFrame(parseInt(frame, 10));
                    selectedKeyframeId = kf.id;
                    currentShape = {};
                    updateKeyframesList();
                    updateShapeEditor();
                });
                keyframesList.appendChild(li);
            });
        });
    }

    function updateLayersList() {
        layersList.innerHTML = '';
        layers.forEach(layer => {
            const li = document.createElement('li');
            li.textContent = layer.name;
            li.dataset.layerId = layer.id;
            if (layer.id === selectedLayerId) {
                li.classList.add('selected');
            }
            li.addEventListener('click', () => selectLayer(layer.id));
            layersList.appendChild(li);
        });
    }

    function selectLayer(layerId) {
        selectedLayerId = layerId;
        selectedKeyframeId = null; // Clear keyframe selection when layer changes
        updateLayersList();
        updateKeyframesList();
        updateShapeEditor(); // Add this call
    }

    function addLayer() {
        const newLayer = {
            id: nextLayerId++,
            name: `レイヤー ${nextLayerId - 1}`,
            keyframes: {},
            lastUsedRadius: 0 // Initialize property for radius inheritance
        };
        layers.push(newLayer);
        updateLayersList();
        selectLayer(newLayer.id);
    }

    function deleteLayer() {
        if (!selectedLayerId) return;
        layers = layers.filter(l => l.id !== selectedLayerId);
        selectedLayerId = layers.length > 0 ? layers[layers.length - 1].id : null;
        updateLayersList();
        updateKeyframesList();
    }

    function initialize() { 
        addLayer();
    }

    function exportSettings() {
        const settings = {
            layers: layers,
            crop: cropRect,
            startFrame: deleteStartInput.value,
            endFrame: deleteEndInput.value
        };

        const jsonString = JSON.stringify(settings, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mosaic-settings.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        statusDiv.textContent = '設定がエクスポートされました。';
    }

    function importSettings(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const settings = JSON.parse(e.target.result);

                if (!settings || !Array.isArray(settings.layers)) {
                    throw new Error('無効な設定ファイルです: layersプロパティが見つかりません。');
                }

                // Restore state
                layers = settings.layers;
                cropRect = settings.crop || null;
                deleteStartInput.value = settings.startFrame || '';
                deleteEndInput.value = settings.endFrame || '';

                // Recalculate next IDs to prevent collisions
                let maxLayerId = 0;
                let maxKfId = 0;
                layers.forEach(layer => {
                    // Ensure backward compatibility for imported settings
                    layer.lastUsedRadius = layer.lastUsedRadius || 0;
                    if (layer.id > maxLayerId) maxLayerId = layer.id;
                    Object.values(layer.keyframes).forEach(kfs => {
                        kfs.forEach(kf => {
                            if (kf.id > maxKfId) maxKfId = kf.id;
                        });
                    });
                });
                nextLayerId = maxLayerId + 1;
                nextKeyframeId = maxKfId + 1;

                // Reset selection and update UI
                selectedLayerId = null;
                selectedKeyframeId = null;
                if (layers.length > 0) {
                    selectLayer(layers[0].id);
                }
                
                updateLayersList();
                updateKeyframesList();
                updateCropInputs();
                updateShapeEditor();

                statusDiv.textContent = '設定が正常にインポートされました。';
            } catch (error) {
                alert(`設定のインポートに失敗しました: ${error.message}`);
                console.error("Import error:", error);
                statusDiv.textContent = '設定のインポートに失敗しました。';
            }
        };
        reader.readAsText(file);
    }

    // --- Attach Event Listeners ---
    addLayerButton.addEventListener('click', addLayer);
    deleteLayerButton.addEventListener('click', deleteLayer);
    // Drag operations are now initiated on the canvas but tracked on the window
    canvasOverlay.addEventListener('mousedown', handleDragStart);
    canvasOverlay.addEventListener('touchstart', handleDragStart, { passive: false });
    shapeRoundedRectRadio.addEventListener('change', () => { drawingShape = shapeRoundedRectRadio.value; });
    shapeEllipseRadio.addEventListener('change', () => { drawingShape = shapeEllipseRadio.value; });
    exportSettingsButton.addEventListener('click', exportSettings);
    importSettingsInput.addEventListener('change', importSettings);

    clearProcessedButton.addEventListener('click', async () => {
        if (confirm("「processed」フォルダ内のすべての動画が削除されます。よろしいですか？\n（この操作は元に戻せません）")) {
            statusDiv.innerHTML = '完成動画を削除中...';
            try {
                const response = await fetch('/clear_processed_folder', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message || '削除中にエラーが発生しました。');
                }
                statusDiv.textContent = result.message;
            } catch (error) {
                statusDiv.innerHTML = `エラー: ${error.message}`;
                console.error('Error clearing processed folder:', error);
            }
        }
    });

    toggleQualitySettingsButton.addEventListener('click', () => {
        qualitySettingsDiv.classList.toggle('collapsed');
    });

    borderRadiusSlider.addEventListener('input', (e) => {
        const kf = getSelectedKeyframe();
        if (kf && (kf.type === 'rect' || kf.type === 'rounded-rect')) {
            const newRadius = parseFloat(e.target.value);
            kf.borderRadius = newRadius;
            kf.type = 'rounded-rect'; // Ensure its type is correct
            // Store the new radius for inheritance
            const layer = getSelectedLayer();
            if (layer) {
                layer.lastUsedRadius = newRadius;
            }
        }
    });

    function updateShapeEditor() {
        const kf = getSelectedKeyframe();
        shapeEditor.style.display = 'block';
        radiusSetting.style.display = 'none'; // Hide by default

        if (kf) {
            if (kf.type === 'rect' || kf.type === 'rounded-rect') {
                rectInputs.style.display = 'block';
                ellipseInputs.style.display = 'none';
                radiusSetting.style.display = 'block'; // Always show for rect-like shapes

                shapeInputs.x.value = Math.round(kf.x);
                shapeInputs.y.value = Math.round(kf.y);
                shapeInputs.w.value = Math.round(kf.w);
                shapeInputs.h.value = Math.round(kf.h);

                const maxRadius = Math.min(kf.w, kf.h) / 2;
                borderRadiusSlider.max = maxRadius > 0 ? maxRadius : 1;
                // For old 'rect' types, kf.borderRadius will be undefined, defaulting to 0.
                borderRadiusSlider.value = Math.min(kf.borderRadius || 0, maxRadius);

            } else { // Ellipse
                rectInputs.style.display = 'none';
                ellipseInputs.style.display = 'block';
                radiusSetting.style.display = 'none';

                shapeInputs.cx.value = Math.round(kf.cx);
                shapeInputs.cy.value = Math.round(kf.cy);
                shapeInputs.rx.value = Math.round(kf.rx);
                shapeInputs.ry.value = Math.round(kf.ry);
            }
            shapeInputs.rotation.value = Math.round((kf.rotation || 0) * (180 / Math.PI));
        } else {
            // No keyframe selected
            if (shapeRoundedRectRadio.checked) {
                rectInputs.style.display = 'block';
                ellipseInputs.style.display = 'none';
                radiusSetting.style.display = 'block';
                borderRadiusSlider.max = 50; // Default max
                borderRadiusSlider.value = 0; // Default value for new sharp rect
            } else {
                rectInputs.style.display = 'none';
                ellipseInputs.style.display = 'block';
                radiusSetting.style.display = 'none';
            }
            Object.values(shapeInputs).forEach(input => input.value = '');
            shapeInputs.rotation.value = 0;
        }
    }

    Object.values(shapeInputs).forEach(input => {
        input.addEventListener('input', () => {
            const kf = getSelectedKeyframe();
            if (!kf) return;

            if (kf.type === 'rect' || kf.type === 'rounded-rect') {
                kf.x = parseFloat(shapeInputs.x.value) || 0;
                kf.y = parseFloat(shapeInputs.y.value) || 0;
                kf.w = parseFloat(shapeInputs.w.value) || 0;
                kf.h = parseFloat(shapeInputs.h.value) || 0;
                if (kf.type === 'rounded-rect') {
                    const maxRadius = Math.min(kf.w, kf.h) / 2;
                    borderRadiusSlider.max = maxRadius > 0 ? maxRadius : 1;
                    if (kf.borderRadius > maxRadius) {
                        kf.borderRadius = maxRadius;
                        borderRadiusSlider.value = maxRadius;
                    }
                }
            } else { // Ellipse
                kf.cx = parseFloat(shapeInputs.cx.value) || 0;
                kf.cy = parseFloat(shapeInputs.cy.value) || 0;
                kf.rx = parseFloat(shapeInputs.rx.value) || 0;
                kf.ry = parseFloat(shapeInputs.ry.value) || 0;
            }
            kf.rotation = (parseFloat(shapeInputs.rotation.value) || 0) * (Math.PI / 180);
        });
    });

    addKeyframeFromValuesButton.addEventListener('click', () => {
        const layer = getSelectedLayer();
        if (!layer) { alert('Please select a layer first.'); return; }
        const type = shapeRoundedRectRadio.checked ? 'rounded-rect' : 'ellipse';
        const rotation = (parseFloat(shapeInputs.rotation.value) || 0) * (Math.PI / 180);
        const newKeyframe = { id: nextKeyframeId++, type, rotation };
        if (type === 'rounded-rect') {
            const x = parseFloat(shapeInputs.x.value); const y = parseFloat(shapeInputs.y.value);
            const w = parseFloat(shapeInputs.w.value); const h = parseFloat(shapeInputs.h.value);
            newKeyframe.x = !isNaN(x) ? x : 0; newKeyframe.y = !isNaN(y) ? y : 0;
            newKeyframe.w = !isNaN(w) ? w : 50; newKeyframe.h = !isNaN(h) ? h : 50;
            if (type === 'rounded-rect') {
                newKeyframe.borderRadius = parseFloat(borderRadiusSlider.value) || 0;
            }
        } else {
            const cx = parseFloat(shapeInputs.cx.value); const cy = parseFloat(shapeInputs.cy.value);
            const rx = parseFloat(shapeInputs.rx.value); const ry = parseFloat(shapeInputs.ry.value);
            newKeyframe.cx = !isNaN(cx) ? cx : 0; newKeyframe.cy = !isNaN(cy) ? cy : 0;
            newKeyframe.rx = !isNaN(rx) ? rx : 25; newKeyframe.ry = !isNaN(ry) ? ry : 25;
        }
        if (!layer.keyframes[currentFrame]) { layer.keyframes[currentFrame] = []; }
        layer.keyframes[currentFrame].push(newKeyframe);
        selectedKeyframeId = newKeyframe.id;
        updateKeyframesList();
        updateShapeEditor();
    });

    effectTypeSelect.addEventListener('change', () => {
        const effectType = effectTypeSelect.value;
        strengthSetting.style.display = (effectType === 'block' || effectType === 'blur') ? 'block' : 'none';
        colorSetting.style.display = (effectType === 'fill') ? 'block' : 'none';
        imageSetting.style.display = (effectType === 'image') ? 'block' : 'none';
        opacitySetting.style.display = (effectType === 'fill' || effectType === 'image') ? 'block' : 'none';
    });
    mosaicStrengthSlider.addEventListener('input', () => {});
    fillColorInput.addEventListener('input', () => {});
    fillOpacitySlider.addEventListener('input', () => {});

    imageUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) { fillImage = null; fillImageSrc = null; return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            fillImageSrc = e.target.result;
            fillImage = new Image();
            fillImage.onload = () => {};
            fillImage.src = fillImageSrc;
        };
        reader.readAsDataURL(file);
    });

    modeShapesRadio.addEventListener('change', () => { editMode = 'shapes'; cropInputs.style.display = 'none'; });
    modeCropRadio.addEventListener('change', () => { editMode = 'crop'; cropInputs.style.display = 'block'; });

    function updateCropRectFromInputs() {
        if (editMode !== 'crop') return;
        const x = parseInt(cropXInput.value, 10) || 0;
        const y = parseInt(cropYInput.value, 10) || 0;
        const w = parseInt(cropWInput.value, 10) || 0;
        const h = parseInt(cropHInput.value, 10) || 0;
        cropRect = { x, y, w, h };
    }

    function updateCropInputs() {
        if (!cropRect) return;
        cropXInput.value = Math.round(cropRect.x);
        cropYInput.value = Math.round(cropRect.y);
        cropWInput.value = Math.round(cropRect.w);
        cropHInput.value = Math.round(cropRect.h);
    }

    [cropXInput, cropYInput, cropWInput, cropHInput].forEach(input => { input.addEventListener('input', updateCropRectFromInputs); });

    videoUpload.addEventListener('change', async (event) => {
        videoFile = event.target.files[0];
        if (!videoFile) return;
        statusDiv.innerHTML = '動画を解析中...';
        const formData = new FormData();
        formData.append('video', videoFile);
        try {
            const response = await fetch('/get_video_info', { method: 'POST', body: formData });
            const info = await response.json();
            if (!response.ok) { throw new Error(info.error || '動画情報の取得に失敗しました。'); }
            videoFps = info.fps;
            totalFrameCount = info.frameCount;
            videoDuration = info.duration;
            lastFrameIndex = totalFrameCount > 0 ? totalFrameCount - 1 : 0;

            totalFramesElem.textContent = lastFrameIndex;
            timeline.max = lastFrameIndex;
            deleteStartInput.max = lastFrameIndex;
            deleteEndInput.max = lastFrameIndex;
            deleteStartInput.value = 0;
            deleteEndInput.value = lastFrameIndex;
            cropXInput.max = info.width;
            cropWInput.max = info.width;
            cropYInput.max = info.height;
            cropHInput.max = info.height;

            if (info.video_url) {
                videoPreview.src = info.video_url;
            } else {
                videoPreview.src = URL.createObjectURL(videoFile);
            }
            
            statusDiv.innerHTML = '動画の準備ができました。';
            updatePlaybackControls();
        } catch (error) {
            statusDiv.innerHTML = `エラー: ${error.message}`;
            console.error('Error getting video info:', error);
            videoFile = null;
        }
    });

    videoPreview.addEventListener('loadedmetadata', () => {
        canvasOverlay.width = videoPreview.videoWidth;
        canvasOverlay.height = videoPreview.videoHeight;
    });

    function updatePlayPauseIcon(isPlaying) {
        const icon = playPauseButton.querySelector('i');
        if (isPlaying) {
            icon.classList.remove('fa-play');
            icon.classList.add('fa-pause');
            playPauseButton.title = '一時停止';
        } else {
            icon.classList.remove('fa-pause');
            icon.classList.add('fa-play');
            playPauseButton.title = '再生';
        }
    }

    function updatePlaybackControls() {
        if (!videoFile) return;
        prevFrameButton.disabled = currentFrame <= 0;
        nextFrameButton.disabled = currentFrame >= lastFrameIndex;
        startButton.disabled = currentFrame <= 0;
        endButton.disabled = currentFrame >= lastFrameIndex;
    }

    videoPreview.addEventListener('seeked', () => {
        const newFrame = Math.min(Math.round(videoPreview.currentTime * videoFps), lastFrameIndex);
        currentFrame = newFrame;
        timeline.value = newFrame;
        currentFrameElem.textContent = newFrame;
        updateShapeEditor();
        updatePlaybackControls();
    });

    videoPreview.addEventListener('timeupdate', () => {
        // This is now mainly for manual scrubbing when paused.
        // The rVFC loop handles updates during playback.
        if (isRenderPlaying) return;

        const ct = videoPreview.currentTime;
        const newFrame = Math.min(Math.floor(ct * videoFps), lastFrameIndex);
        if (newFrame !== currentFrame) {
            currentFrame = newFrame;
            currentFrameElem.textContent = newFrame;
            if (!timeline.dragging) { timeline.value = newFrame; }
            updatePlaybackControls();
        }
    });

    videoPreview.addEventListener('play', () => {
        updatePlayPauseIcon(true);
    });

    videoPreview.addEventListener('pause', () => {
        if (!isRenderPlaying) {
            updatePlayPauseIcon(false);
        }
    });

    videoPreview.addEventListener('ended', () => {
        isRenderPlaying = false;
        updatePlayPauseIcon(false);
        if (totalFrameCount > 0) {
            seekToFrame(lastFrameIndex);
        }
        updatePlaybackControls();
    });

    function seekToFrame(frame) {
        const targetFrame = Math.max(0, Math.min(frame, lastFrameIndex));
        const newTime = targetFrame / videoFps;
        if (isFinite(newTime) && newTime >= 0 && newTime <= videoDuration) {
            videoPreview.currentTime = newTime;
        }
    }

    timeline.addEventListener('input', (e) => {
        if (isRenderPlaying) {
            isRenderPlaying = false;
            updatePlayPauseIcon(false);
        }
        timeline.dragging = true;
        currentFrameElem.textContent = e.target.value;
    });
    timeline.addEventListener('change', (e) => {
        seekToFrame(parseInt(e.target.value, 10));
        timeline.dragging = false;
    });

    let rVFC_handle = null;

    function videoFrameCallback() {
        // This function is called whenever the browser is ready to paint a new frame.
        const newFrame = Math.min(Math.round(videoPreview.currentTime * videoFps), lastFrameIndex);
        if (newFrame !== currentFrame) {
            currentFrame = newFrame;
            timeline.value = newFrame;
            currentFrameElem.textContent = newFrame;
            updateShapeEditor();
            updatePlaybackControls();
        }
        
        // Continue the loop
        if (isRenderPlaying) {
            rVFC_handle = videoPreview.requestVideoFrameCallback(videoFrameCallback);
        }
    }

    playPauseButton.addEventListener('click', async () => {
        if (isRenderPlaying) {
            isRenderPlaying = false;
            videoPreview.pause();
            if (rVFC_handle && videoPreview.cancelVideoFrameCallback) {
                videoPreview.cancelVideoFrameCallback(rVFC_handle);
            }
            updatePlayPauseIcon(false);
        } else {
            if (videoFile) {
                if (currentFrame >= lastFrameIndex) {
                    videoPreview.currentTime = 0;
                    await new Promise(r => setTimeout(r, 100)); // Short delay to ensure seek completes
                }
                isRenderPlaying = true;
                videoPreview.play();
                if (videoPreview.requestVideoFrameCallback) {
                    rVFC_handle = videoPreview.requestVideoFrameCallback(videoFrameCallback);
                } 
                updatePlayPauseIcon(true);
            }
        }
    });

    nextFrameButton.addEventListener('click', () => seekToFrame(currentFrame + 1));
    prevFrameButton.addEventListener('click', () => seekToFrame(currentFrame - 1));
    startButton.addEventListener('click', () => seekToFrame(0));
    endButton.addEventListener('click', () => seekToFrame(lastFrameIndex));
    setDeleteStartButton.addEventListener('click', () => { deleteStartInput.value = currentFrame; });
    setDeleteEndButton.addEventListener('click', () => { deleteEndInput.value = currentFrame; });


    deleteKeyframeButton.addEventListener('click', () => {
        const layer = getSelectedLayer();
        if (!layer || selectedKeyframeId === null) return;
        const kfs = layer.keyframes[currentFrame];
        if (!kfs) return;
        const index = kfs.findIndex(kf => kf.id === selectedKeyframeId);
        if (index > -1) {
            kfs.splice(index, 1);
            if (kfs.length === 0) { delete layer.keyframes[currentFrame]; }
            selectedKeyframeId = null;
            updateKeyframesList();
            updateShapeEditor();
        }
    });

    processButton.addEventListener('click', async () => {
        if (!videoFile) { alert('動画ファイルを選択してください。'); return; }
        statusDiv.innerHTML = '処理中... 動画の長さに応じて時間がかかります。';
        const settings = {
            layers: layers,
            effectType: effectTypeSelect.value,
            mosaicStrength: mosaicStrengthSlider.value,
            startFrame: deleteStartInput.value,
            endFrame: deleteEndInput.value,
            crop: cropRect,
            fillColor: fillColorInput.value,
            fillOpacity: fillOpacitySlider.value,
            fillImage: fillImageSrc,
            quality: qualitySlider.value
        };
        const formData = new FormData();
        formData.append('video', videoFile);
        formData.append('settings', JSON.stringify(settings));
        try {
            const response = await fetch('/process_video', { method: 'POST', body: formData });
            if (!response.ok) { const error = await response.json(); throw new Error(error.error || `サーバーエラー: ${response.status}`); }
            const result = await response.json();
            statusDiv.innerHTML = `処理完了！ <a href="${result.download_url}" download>ここをクリックしてダウンロード</a>`;
        } catch (error) {
            statusDiv.innerHTML = `エラーが発生しました: ${error.message}`;
            console.error('Processing error:', error);
        }
    });

    // --- Initialization and Render Loop ---
    function renderLoop() {
        drawCanvas();
        animationFrameId = requestAnimationFrame(renderLoop);
    }

    initialize();
    renderLoop();
});