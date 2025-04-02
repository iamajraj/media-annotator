class MediaAnnotator {
    constructor(options = {}) {
        this.options = {
            initialColor: "#FF0000",
            initialWidth: 4, // This is NATURAL width
            timeThreshold: 0.25,
            defaultTool: "select",
            defaultDurationSeconds: 1, // Default annotation display time in seconds
            ...options,
        };

        // DOM Element References
        this.mediaWrapper = document.getElementById("media-wrapper");
        this.konvaContainer = document.getElementById("konva-container");
        this.loadingOverlay = document.getElementById("loading-overlay");
        this.loadingMessage = document.getElementById("loading-message");
        this.rightSidebar = document.getElementById("right-sidebar");
        this.jsonViewer = document.getElementById("json-viewer");
        this.jsonViewerHeader = document.getElementById("json-viewer-header");
        this.jsonOutput = document.getElementById("json-output");
        this.jsonToggleIcon = document.getElementById("json-toggle-icon");
        this.videoEl = document.getElementById("annotator-video");
        this.imageEl = document.getElementById("annotator-image");
        this.fileInput = document.getElementById("annotator-file");
        this.colorPicker = document.getElementById("annotator-color");
        this.lineWidthSlider = document.getElementById("annotator-width");
        this.lineWidthDisplay = document.getElementById("annotator-width-display");
        this.toolButtons = {
            select: document.getElementById("tool-select"),
            arrow: document.getElementById("tool-arrow"),
            draw: document.getElementById("tool-draw"),
            text: document.getElementById("tool-text"),
            "rect-border": document.getElementById("tool-rect-border"),
            "rect-fill": document.getElementById("tool-rect-fill"),
        };
        this.btnPreview = document.getElementById("btn-preview");
        this.btnSaveSnapshot = document.getElementById("btn-save-snapshot");
        this.btnSaveImage = document.getElementById("btn-save-image");
        this.btnExportJson = document.getElementById("btn-export-json");
        this.btnLoadJson = document.getElementById("btn-load-json");
        this.btnClearAll = document.getElementById("btn-clear-all");
        this.playPauseBtn = document.getElementById("play-pause-btn");
        this.progressBar = document.getElementById("progress-bar");
        this.timeDisplay = document.getElementById("time-display");
        this.previewModal = document.getElementById("preview-modal");
        this.previewModalClose = document.getElementById("preview-modal-close");
        this.previewModalCloseBtn = document.getElementById("preview-modal-close-btn");
        this.previewVideoEl = document.getElementById("preview-video");
        this.previewKonvaContainer = document.getElementById("preview-konva-container");
        this.previewMediaWrapper = document.getElementById("preview-media-wrapper");

        // States
        this.stage = null;
        this.layer = null;
        this.transformer = null;
        this.previewStage = null;
        this.previewLayer = null;
        this.previewAnnotations = [];
        this.previewRafId = null;
        this.annotations = [];
        this.currentTool = this.options.defaultTool;
        this.currentColor = this.options.initialColor;
        this.currentLineWidth = this.options.initialWidth;
        this.isDrawing = false;
        this.startPos = null;
        this.currentShape = null;
        this.selectedShape = null;
        this.mediaType = null;
        this.mediaLoaded = false;
        this.mediaObjectURL = null;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        this.renderWidth = 0;
        this.renderHeight = 0;
        this.scaleFactor = 1;
        this.resizeObserver = null;
        this.resizeTimeout = null;

        this._bindMethods();
        this._setupEventListeners();
        this._initializeUIState();
        this._setupResizeObserver();
    }

    _bindMethods() {
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this)).filter(
            (prop) => prop.startsWith("_handle") || ["saveSnapshot", "saveImage", "exportAnnotationData", "loadAnnotations", "clearAllAnnotations", "preview", "destroy"].includes(prop)
        );
        methods.forEach((method) => {
            this[method] = this[method].bind(this);
        });
    }

    _initializeUIState() {
        this.colorPicker.value = this.options.initialColor;
        this.lineWidthSlider.value = this.options.initialWidth;
        this.lineWidthDisplay.textContent = this.options.initialWidth;
        this.currentColor = this.options.initialColor;
        this.currentLineWidth = this.options.initialWidth; // Stored value is natural
        this._setActiveTool(this.currentTool);
        this._updateMediaControls();
        this._updateProgressBarVisual(0, 0);
        this.rightSidebar.classList.remove("is-active"); // Start collapsed
        this.jsonOutput.value = "";
        this.jsonOutput.placeholder = "Load media and add annotations...";
    }

    _setupEventListeners() {
        this.fileInput.addEventListener("change", this._handleFileChange.bind(this));
        Object.values(this.toolButtons).forEach((button) => {
            button.addEventListener("click", (e) => this._setActiveTool(e.currentTarget.dataset.tool));
        });
        this.colorPicker.addEventListener("input", this._updateColor.bind(this));
        this.lineWidthSlider.addEventListener("input", this._updateLineWidth.bind(this));
        this.btnPreview.addEventListener("click", this.preview.bind(this));
        this.btnSaveSnapshot.addEventListener("click", this.saveSnapshot.bind(this));
        this.btnSaveImage.addEventListener("click", this.saveImage.bind(this));
        this.btnExportJson.addEventListener("click", this._handleExportClick.bind(this));
        this.btnLoadJson.addEventListener("click", this._handleLoadJsonClick.bind(this));
        this.btnClearAll.addEventListener("click", this.clearAllAnnotations.bind(this));
        this.playPauseBtn.addEventListener("click", this._handlePlayPause.bind(this));
        this.progressBar.addEventListener("input", this._handleSeekInput.bind(this));
        this.progressBar.addEventListener("change", this._handleSeekChange.bind(this));
        this.videoEl.addEventListener("loadedmetadata", () => this._onMediaMetadataLoaded(this.videoEl));
        this.videoEl.addEventListener("timeupdate", this._handleTimeUpdate.bind(this));
        this.videoEl.addEventListener("play", () => this._updatePlayButtonIcon(false));
        this.videoEl.addEventListener("pause", () => this._updatePlayButtonIcon(true));
        this.videoEl.addEventListener("ended", this._handleVideoEnded.bind(this));
        this.videoEl.addEventListener("seeked", this._handleVideoSeeked.bind(this));
        this.imageEl.addEventListener("load", () => this._onMediaMetadataLoaded(this.imageEl));
        this.imageEl.addEventListener("error", this._handleMediaError.bind(this));
        this.jsonViewerHeader.addEventListener("click", this._handleJsonToggle.bind(this));
        this.previewModalClose.addEventListener("click", this._closePreviewModal.bind(this));
        this.previewModalCloseBtn.addEventListener("click", this._closePreviewModal.bind(this));
    }

    _setupResizeObserver() {
        const container = document.querySelector(".media-container");
        if (!container) return;
        this.resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                if (entry.target === container) {
                    this._handleResize();
                }
            }
        });
        this.resizeObserver.observe(container);
    }

    _setupKonva(targetStage = "main") {
        let stageRef, layerRef, containerRef, width, height, isPreview, scaleFactor;
        if (targetStage === "main") {
            if (!this.mediaLoaded || this.renderWidth <= 0 || this.renderHeight <= 0) return;
            width = this.renderWidth;
            height = this.renderHeight;
            containerRef = this.konvaContainer;
            isPreview = false;
            scaleFactor = this.scaleFactor;
        } else {
            width = this.previewVideoEl.clientWidth;
            height = this.previewVideoEl.clientHeight;
            if (width <= 0 || height <= 0) {
                console.warn("Preview media dimensions not ready");
                width = this.naturalWidth * this.scaleFactor;
                height = this.naturalHeight * this.scaleFactor;
                if (width <= 0) return;
            }
            containerRef = this.previewKonvaContainer;
            isPreview = true;
            scaleFactor = width / this.naturalWidth;
        }

        let currentStage = isPreview ? this.previewStage : this.stage;
        if (currentStage) {
            if (!isPreview) window.removeEventListener("keydown", this._handleKeyDown);
            currentStage.destroy();
        }
        containerRef.innerHTML = "";
        containerRef.style.width = `${width}px`;
        containerRef.style.height = `${height}px`;
        const stage = new Konva.Stage({ container: containerRef, width: width, height: height });
        const layer = new Konva.Layer();
        stage.add(layer);

        if (isPreview) {
            this.previewStage = stage;
            this.previewLayer = layer;
            containerRef.style.pointerEvents = "none";
            console.log(`Preview Konva: ${width}x${height}`);
            this._recreateKonvaShapesFromData(this.previewAnnotations, stage, layer, isPreview, scaleFactor);
        } else {
            this.stage = stage;
            this.layer = layer;
            this.transformer = new Konva.Transformer({
                keepRatio: true,
                enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
                borderDash: [3, 3],
                borderStroke: "var(--primary-color)",
                anchorStroke: "var(--primary-color)",
                anchorFill: "var(--bg-dark-3)",
                anchorSize: 8,
                rotateEnabled: false,
            });
            this.layer.add(this.transformer);
            this.transformer.nodes([]);
            stage.on("mousedown touchstart", this._handleStageMouseDown);
            stage.on("mousemove touchmove", this._handleStageMouseMove);
            stage.on("mouseup touchend", this._handleStageMouseUp);
            stage.on("click tap", this._handleStageClick);
            stage.container().addEventListener("mouseenter", () => window.addEventListener("keydown", this._handleKeyDown));
            stage.container().addEventListener("mouseleave", () => window.removeEventListener("keydown", this._handleKeyDown));
            console.log(`Main Konva: ${this.renderWidth}x${this.renderHeight}`);
            this._setCursorForTool(this.currentTool);
            containerRef.style.pointerEvents = "auto";
            this._recreateKonvaShapesFromData(this.annotations, stage, layer, isPreview, scaleFactor);
            this._renderCurrentAnnotations();
        }
    }

    // Media Loading & Handling
    _handleFileChange(event) {
        const file = event.target.files[0];
        if (!file) return;
        this._resetToDefaultState();
        if (file.type.startsWith("video/")) {
            this.mediaType = "video";
            this.loadMedia(file, this.videoEl);
        } else if (file.type.startsWith("image/")) {
            this.mediaType = "image";
            this.loadMedia(file, this.imageEl);
        } else {
            alert("Please select a valid video or image file.");
            this._resetToDefaultState();
        }
        event.target.value = "";
    }
    loadMedia(source, element) {
        this._showLoading("Loading media...");
        if (this.mediaObjectURL) {
            URL.revokeObjectURL(this.mediaObjectURL);
        }
        let url = source instanceof File ? URL.createObjectURL(source) : source;
        if (source instanceof File) this.mediaObjectURL = url;
        console.log(`Loading ${this.mediaType}:`, source.name || source);
        element.src = url;
        const isVideo = element.tagName === "VIDEO";
        this.videoEl.style.display = isVideo ? "block" : "none";
        this.imageEl.style.display = isVideo ? "none" : "block";
        if (isVideo) element.load();
    }
    _onMediaMetadataLoaded(element) {
        console.log(`${this.mediaType} metadata loaded.`);
        this.mediaLoaded = true;
        if (this.mediaType === "video") {
            this.naturalWidth = element.videoWidth;
            this.naturalHeight = element.videoHeight;
            this.progressBar.max = element.duration;
            this.videoEl.currentTime = 0;
        } else {
            this.naturalWidth = element.naturalWidth;
            this.naturalHeight = element.naturalHeight;
        }
        if (this.naturalWidth > 0 && this.naturalHeight > 0) {
            this._calculateRenderSize();
            this._setupKonva("main");
        } else {
            console.error("Media dimensions are zero.");
            alert(`Failed to get dimensions.`);
            this._resetToDefaultState();
        }
        this._updateMediaControls();
        this._updateTimeDisplay();
        this._hideLoading();
        this.jsonOutput.placeholder = "Add annotations...";
    }
    _calculateRenderSize() {
        if (!this.mediaLoaded || !this.naturalWidth) return;
        const container = document.querySelector(".media-container");
        const maxWidth = container.clientWidth - 32;
        const maxHeight = container.clientHeight - 32;
        const ratio = Math.min(maxWidth / this.naturalWidth, maxHeight / this.naturalHeight, 1);
        /* Cap scale at 1? Optional */ this.renderWidth = Math.floor(this.naturalWidth * ratio);
        this.renderHeight = Math.floor(this.naturalHeight * ratio);
        this.scaleFactor = ratio;
        this.mediaWrapper.style.width = `${this.renderWidth}px`;
        this.mediaWrapper.style.height = `${this.renderHeight}px`;
        console.log(`Render: ${this.renderWidth}x${this.renderHeight}, Scale: ${this.scaleFactor.toFixed(3)}`);
    }
    _handleResize() {
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            if (this.mediaLoaded && this.naturalWidth > 0) {
                console.log("Handling resize...");
                this._calculateRenderSize();
                if (this.stage) {
                    this.stage.width(this.renderWidth);
                    this.stage.height(this.renderHeight);
                    this.konvaContainer.style.width = `${this.renderWidth}px`;
                    this.konvaContainer.style.height = `${this.renderHeight}px`;
                    this._rescaleKonvaShapes("main");
                    this.layer.batchDraw();
                } else {
                    this._setupKonva("main");
                }
            }
        }, 150);
    }
    _rescaleKonvaShapes(target = "main") {
        const { stage, layer, annotations, scaleFactor } =
            target === "preview"
                ? { stage: this.previewStage, layer: this.previewLayer, annotations: this.previewAnnotations, scaleFactor: this.previewVideoEl.clientWidth / this.naturalWidth }
                : { stage: this.stage, layer: this.layer, annotations: this.annotations, scaleFactor: this.scaleFactor };
        if (!layer || !annotations.length || !scaleFactor) return;
        layer
            .getChildren((node) => node !== this.transformer && !(node instanceof Konva.Transformer))
            .forEach((shape) => {
                const annData = annotations.find((a) => a.konvaId === shape.id());
                if (annData) {
                    const scaledAttrs = this._scaleAnnotationDataToRender(annData.data, scaleFactor);
                    const isSelected = target === "main" && this.selectedShape && this.selectedShape.id() === shape.id();
                    scaledAttrs.draggable = isSelected && this.currentTool === "select";
                    shape.setAttrs(scaledAttrs);
                }
            });
        if (target === "main" && this.transformer && this.transformer.nodes().length > 0) {
            this.transformer.forceUpdate();
        }
    }
    _resetToDefaultState() {
        console.log("Resetting state.");
        this.mediaLoaded = false;
        this.mediaType = null;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        this.renderWidth = 0;
        this.renderHeight = 0;
        this.scaleFactor = 1;
        this.clearAllAnnotations(false);
        if (this.stage) {
            window.removeEventListener("keydown", this._handleKeyDown);
            this.stage.destroy();
            this.stage = null;
            this.layer = null;
            this.transformer = null;
        }
        this.konvaContainer.innerHTML = "";
        this.konvaContainer.style.pointerEvents = "none";
        this.mediaWrapper.style.width = "auto";
        this.mediaWrapper.style.height = "auto";
        this.videoEl.style.display = "block";
        this.imageEl.style.display = "none";
        this.videoEl.removeAttribute("src");
        this.imageEl.removeAttribute("src");
        if (this.videoEl.srcObject) this.videoEl.srcObject = null;
        if (this.mediaObjectURL) {
            URL.revokeObjectURL(this.mediaObjectURL);
            this.mediaObjectURL = null;
        }
        this.progressBar.value = 0;
        this.progressBar.max = 100;
        this._updateMediaControls();
        this._updateTimeDisplay();
        this._updateProgressBarVisual(0, 0);
        this._hideLoading();
        this._setActiveTool(this.options.defaultTool);
        this.jsonOutput.value = "";
        this.jsonOutput.placeholder = "Load media first...";
        this.rightSidebar.classList.remove("is-active");
        this._closePreviewModal();
    }
    _updateMediaControls() {
        const isVideo = this.mediaType === "video";
        const isImage = this.mediaType === "image";
        const mediaReady = this.mediaLoaded && this.naturalWidth > 0;
        this.playPauseBtn.disabled = !mediaReady || !isVideo;
        this.progressBar.disabled = !mediaReady || !isVideo;
        this.timeDisplay.style.visibility = isVideo ? "visible" : "hidden";
        if (!isVideo) {
            this.progressBar.value = 0;
            this.progressBar.style.setProperty("--progress", "0%");
            this._updatePlayButtonIcon(true);
        }
        this.btnPreview.disabled = !mediaReady || !isVideo;
        this.btnSaveSnapshot.disabled = !mediaReady || !isVideo;
        this.btnSaveImage.disabled = !mediaReady || !isImage;
        this.btnSaveImage.classList.toggle("is-hidden", !isImage);
        this.btnSaveSnapshot.classList.toggle("is-hidden", isImage);
        this.konvaContainer.style.pointerEvents = mediaReady ? "auto" : "none";
        this.btnExportJson.disabled = !mediaReady;
        this.btnClearAll.disabled = !mediaReady;
    }
    _updatePlayButtonIcon(isPaused) {
        this.playPauseBtn.querySelector("i").className = `fas ${isPaused ? "fa-play" : "fa-pause"}`;
    }
    _updateProgressBarVisual(currentTime, duration) {
        const percentage = duration > 0 ? (currentTime / duration) * 100 : 0;
        this.progressBar.style.setProperty("--progress", `${percentage}%`);
    }
    _handleMediaError(event) {
        console.error("Media loading error:", event);
        alert(`Error loading ${this.mediaType || "media"}.`);
        this._resetToDefaultState();
    }

    // Event Handlers (Controls, Konva, Keyboard, UI)
    _handlePlayPause() {
        if (!this.mediaLoaded || this.mediaType !== "video") return;
        if (this.videoEl.paused || this.videoEl.ended) {
            this.videoEl.play().catch((e) => console.error("Play error:", e));
        } else {
            this.videoEl.pause();
        }
    }
    _handleTimeUpdate() {
        if (!this.videoEl || isNaN(this.videoEl.duration)) return;
        const currentTime = this.videoEl.currentTime;
        const duration = this.videoEl.duration;
        if (!this.progressBar.matches(":active")) {
            this.progressBar.value = currentTime;
        }
        this._updateProgressBarVisual(currentTime, duration);
        this._updateTimeDisplay();
        this._renderAnnotationsForTime(currentTime, "main");
    }
    _handleVideoEnded() {
        this._updatePlayButtonIcon(true);
        this.videoEl.currentTime = 0;
        this._renderAnnotationsForTime(0, "main");
        this._updateProgressBarVisual(0, this.videoEl.duration);
    }
    _handleVideoSeeked() {
        const time = this.videoEl.currentTime;
        console.log(`Seeked to: ${time.toFixed(2)}s`);
        if (this.mediaLoaded) {
            this._renderAnnotationsForTime(time, "main");
        }
        this._updateTimeDisplay();
        this._updateProgressBarVisual(time, this.videoEl.duration);
    }
    _handleSeekInput(event) {
        if (!this.mediaLoaded || this.mediaType !== "video" || isNaN(this.videoEl.duration)) return;
        const seekTime = parseFloat(event.target.value);
        this._updateProgressBarVisual(seekTime, this.videoEl.duration);
        this._updateTimeDisplay(seekTime);
        this._renderAnnotationsForTime(seekTime, "main");
    }
    _handleSeekChange(event) {
        if (!this.mediaLoaded || this.mediaType !== "video" || isNaN(this.videoEl.duration)) return;
        const seekTime = parseFloat(event.target.value);
        this.videoEl.currentTime = seekTime;
    }
    _updateTimeDisplay(time = null) {
        const formatTime = (t) => {
            if (isNaN(t) || t === Infinity) return "0:00";
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            return `${m}:${s.toString().padStart(2, "0")}`;
        };
        const current = formatTime(time ?? (this.mediaType === "video" ? this.videoEl.currentTime : 0));
        const duration = formatTime(this.mediaType === "video" ? this.videoEl.duration : 0);
        this.timeDisplay.textContent = `${current} / ${duration}`;
    }
    _updateColor(event) {
        this.currentColor = event.target.value;
        console.log("Color updated:", this.currentColor);
        this._updateSelectedShapeStyle();
    }
    _updateLineWidth(event) {
        this.currentLineWidth = parseInt(event.target.value, 10);
        this.lineWidthDisplay.textContent = this.currentLineWidth;
        console.log("Width updated (natural):", this.currentLineWidth);
        this._updateSelectedShapeStyle();
    }
    _updateSelectedShapeStyle() {
        if (this.selectedShape) {
            console.log("Applying style to selected:", this.selectedShape.id());
            this._applyStyleToShape(this.selectedShape);
            this._updateAnnotationData(this.selectedShape);
            this.layer.batchDraw();
        }
    }

    _handleStageMouseDown(e) {
        if (!this.mediaLoaded || (this.mediaType === "video" && !this.videoEl.paused)) return;
        if (this.currentTool === "select" && e.target !== this.stage && !(e.target.getParent() instanceof Konva.Transformer)) return;
        if (e.target.getParent() instanceof Konva.Transformer) return;
        if (e.target === this.stage) {
            if (this.selectedShape) {
                this.selectedShape.draggable(false);
            }
            this.transformer.nodes([]);
            this.selectedShape = null;
            this.layer.batchDraw();
        }
        if (this.currentTool !== "select" && e.target === this.stage) {
            this.isDrawing = true;
            this.startPos = this.stage.getPointerPosition();
            const id = this._generateKonvaId();
            const baseAttrs = { draggable: false, id: id };
            switch (this.currentTool) {
                case "arrow":
                    this.currentShape = new Konva.Arrow({ points: [this.startPos.x, this.startPos.y, this.startPos.x, this.startPos.y], ...baseAttrs });
                    break;
                case "draw":
                    this.currentShape = new Konva.Line({ points: [this.startPos.x, this.startPos.y], lineCap: "round", lineJoin: "round", tension: 0.5, ...baseAttrs });
                    break;
                case "rect-border":
                case "rect-fill":
                    this.currentShape = new Konva.Rect({ x: this.startPos.x, y: this.startPos.y, width: 0, height: 0, ...baseAttrs });
                    break;
                case "text":
                    this.isDrawing = false;
                    break;
            }
            if (this.currentShape) {
                this._applyStyleToShape(this.currentShape);
                this.layer.add(this.currentShape);
                this.layer.batchDraw();
            }
        }
    }
    _handleStageMouseMove(e) {
        if (!this.isDrawing || !this.currentShape || !this.startPos) return;
        const pos = this.stage.getPointerPosition();
        if (!pos) return;
        switch (this.currentTool) {
            case "arrow":
                this.currentShape.points([this.startPos.x, this.startPos.y, pos.x, pos.y]);
                break;
            case "draw":
                this.currentShape.points(this.currentShape.points().concat([pos.x, pos.y]));
                break;
            case "rect-border":
            case "rect-fill":
                this.currentShape.width(pos.x - this.startPos.x);
                this.currentShape.height(pos.y - this.startPos.y);
                break;
        }
        this.layer.batchDraw();
    }
    _handleStageMouseUp(e) {
        const wasDrawing = this.isDrawing;
        this.isDrawing = false;
        if (!this.mediaLoaded || (this.mediaType === "video" && !this.videoEl.paused)) {
            if (this.currentShape && wasDrawing) {
                this.currentShape.destroy();
                this.layer.batchDraw();
            }
            this.currentShape = null;
            this.startPos = null;
            return;
        }
        if (!wasDrawing && this.currentTool === "text" && e.target === this.stage) {
            const clickPos = this.stage.getPointerPosition();
            if (!clickPos) return;
            const textContent = prompt("Enter annotation text:");
            if (textContent && textContent.trim() !== "") {
                const id = this._generateKonvaId();
                const textNode = new Konva.Text({ x: clickPos.x, y: clickPos.y, text: textContent, fontSize: 16, draggable: false, id: id });
                this._applyStyleToShape(textNode);
                this._addKonvaListeners(textNode);
                this.layer.add(textNode);
                this._addAnnotation(this.currentTool, textNode);
                this.layer.batchDraw();
            }
            return;
        }
        if (wasDrawing && this.currentShape) {
            const type = this.currentTool;
            let shapeIsValid = false;
            const minLength = 5,
                minDrawPoints = 3;
            if (type === "arrow") {
                const pts = this.currentShape.points();
                shapeIsValid = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]) >= minLength;
            } else if (type === "draw") {
                shapeIsValid = this.currentShape.points().length / 2 >= minDrawPoints;
            } else if (type === "rect-border" || type === "rect-fill") {
                shapeIsValid = Math.abs(this.currentShape.width()) >= minLength || Math.abs(this.currentShape.height()) >= minLength;
                if (shapeIsValid) {
                    if (this.currentShape.width() < 0) {
                        this.currentShape.x(this.currentShape.x() + this.currentShape.width());
                        this.currentShape.width(-this.currentShape.width());
                    }
                    if (this.currentShape.height() < 0) {
                        this.currentShape.y(this.currentShape.y() + this.currentShape.height());
                        this.currentShape.height(-this.currentShape.height());
                    }
                }
            }
            if (shapeIsValid) {
                this._addKonvaListeners(this.currentShape);
                this._addAnnotation(type, this.currentShape);
            } else {
                this.currentShape.destroy();
                console.log("Shape too small.");
            }
            this.layer.batchDraw();
        } else if (this.currentShape) {
            this.currentShape.destroy();
            this.layer.batchDraw();
        }
        this.currentShape = null;
        this.startPos = null;
    }
    _handleStageClick(e) {
        if (this.currentTool !== "select" || !this.mediaLoaded) return;
        if (e.target.getParent() instanceof Konva.Transformer) return;
        if (e.target === this.stage) {
            if (this.selectedShape) {
                this.selectedShape.draggable(false);
            }
            this.transformer.nodes([]);
            this.selectedShape = null;
            this.layer.batchDraw();
            return;
        }
        const clickedShape = e.target;
        if (clickedShape.getParent() === this.layer && clickedShape.isVisible()) {
            if (this.selectedShape && this.selectedShape !== clickedShape) {
                this.selectedShape.draggable(false);
            }
            this.selectedShape = clickedShape;
            this.transformer.nodes([clickedShape]);
            this.selectedShape.draggable(true);
            this.layer.batchDraw();
            this._matchControlsToShape(clickedShape);
        } else {
            if (this.selectedShape) {
                this.selectedShape.draggable(false);
            }
            this.transformer.nodes([]);
            this.selectedShape = null;
            this.layer.batchDraw();
        }
    }
    _handleKeyDown(e) {
        if (!this.selectedShape) return;
        if (e.key === "Delete" || e.key === "Backspace") {
            this._deleteSelectedAnnotation();
            e.preventDefault();
        } else if (e.key === "Escape") {
            this.selectedShape.draggable(false);
            this.transformer.nodes([]);
            this.selectedShape = null;
            this.layer.batchDraw();
            e.preventDefault();
        }
    }
    _handleJsonToggle() {
        this.rightSidebar.classList.toggle("is-active");
    }
    _handleLoadJsonClick() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    this.loadAnnotations(event.target.result);
                } catch (err) {
                    console.error("JSON Load Error:", err);
                    alert("Could not read/parse JSON.");
                }
            };
            reader.onerror = () => alert("Error reading file.");
            reader.readAsText(file);
        };
        input.click();
    }
    _handleExportClick() {
        this.exportAnnotationData();
        this.rightSidebar.classList.add("is-active"); /* Show panel on export */
    }

    // Annotation & Konva Management
    _generateKonvaId() {
        return "ann-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
    }

    _applyStyleToShape(shape) {
        if (!shape || !this.scaleFactor) return;
        const type = shape.getClassName();
        let attrs = {};
        const isSelected = this.selectedShape && this.selectedShape.id() === shape.id();
        const scale = this.scaleFactor;
        // Use NATURAL this.currentLineWidth for calculations
        const naturalWidth = this.currentLineWidth;
        const renderWidth = Math.max(1, naturalWidth * scale); // Ensure at least 1px render width

        if (type === "Text") {
            attrs.fill = this.currentColor;
            attrs.fontSize = Math.max(16 * scale, renderWidth * 3 + 4 * scale);
        } else if (type === "Arrow" || type === "Line") {
            attrs.stroke = this.currentColor;
            attrs.strokeWidth = renderWidth;
            if (type === "Arrow") {
                attrs.fill = this.currentColor;
                const ps = Math.max(8 * scale, renderWidth * 2);
                attrs.pointerLength = ps;
                attrs.pointerWidth = ps;
            }
        } else if (type === "Rect") {
            const annData = this.annotations.find((a) => a.konvaId === shape.id());
            const rectType = annData ? annData.type : this.currentTool;
            if (rectType === "rect-border") {
                attrs.stroke = this.currentColor;
                attrs.strokeWidth = renderWidth;
                attrs.fillEnabled = false;
                attrs.strokeEnabled = true;
            } else {
                attrs.fill = this.currentColor;
                attrs.strokeEnabled = false;
                attrs.fillEnabled = true;
            }
            attrs.listening = true;
        }
        attrs.draggable = isSelected && this.currentTool === "select"; // Set draggable based on selection state
        shape.setAttrs(attrs);
        // console.log(`Applied style to ${shape.id()}:`, attrs);
    }

    _matchControlsToShape(shape) {
        if (!shape || !this.scaleFactor) return;
        const type = shape.getClassName();
        const scale = this.scaleFactor;
        try {
            if (type === "Text") {
                this.colorPicker.value = shape.fill();
                this.currentColor = shape.fill();
                const renderFontSize = shape.fontSize();
                const naturalFontSize = renderFontSize / scale;
                const effectiveWidth = Math.max(1, Math.round((naturalFontSize - 4 * scale) / 3));
                this.lineWidthSlider.value = effectiveWidth;
                this.lineWidthDisplay.textContent = effectiveWidth;
                this.currentLineWidth = effectiveWidth;
            } else if (type === "Arrow" || type === "Line") {
                this.colorPicker.value = shape.stroke();
                this.currentColor = shape.stroke();
                const renderWidth = shape.strokeWidth();
                const naturalWidth = Math.max(1, renderWidth / scale);
                this.lineWidthSlider.value = Math.round(naturalWidth);
                this.lineWidthDisplay.textContent = Math.round(naturalWidth);
                this.currentLineWidth = naturalWidth;
            } else if (type === "Rect") {
                const annData = this.annotations.find((a) => a.konvaId === shape.id());
                if (annData?.type === "rect-border" && shape.strokeEnabled()) {
                    this.colorPicker.value = shape.stroke();
                    this.currentColor = shape.stroke();
                    const renderWidth = shape.strokeWidth();
                    const naturalWidth = Math.max(1, renderWidth / scale);
                    this.lineWidthSlider.value = Math.round(naturalWidth);
                    this.lineWidthDisplay.textContent = Math.round(naturalWidth);
                    this.currentLineWidth = naturalWidth;
                } else if (annData?.type === "rect-fill" && shape.fillEnabled()) {
                    this.colorPicker.value = shape.fill();
                    this.currentColor = shape.fill(); /* Width slider may not directly map */
                }
            }
        } catch (e) {
            console.error("Error matching controls:", e, shape);
        }
    }

    _addKonvaListeners(shape) {
        shape.off("dragend transformend mouseenter mouseleave");
        shape.on("dragend transformend", () => {
            if (this.selectedShape === shape) {
                this._updateAnnotationData(shape);
            }
        });
        shape.on("mouseenter", () => {
            if (this.currentTool === "select" && this.stage?.container()) {
                this.stage.container().style.cursor = this.selectedShape === shape ? "move" : "pointer";
            }
        });
        shape.on("mouseleave", () => {
            if (this.currentTool === "select" && this.stage?.container()) {
                this._setCursorForTool(this.currentTool);
            }
        });
    }
    _addAnnotation(type, konvaShape) {
        if (!konvaShape || !this.mediaLoaded) return;
        const annotation = { konvaId: konvaShape.id(), type: type, data: this._scaleKonvaDataToNatural(konvaShape) };
        if (this.mediaType === "video") {
            annotation.startTime = Math.floor(this.videoEl.currentTime);
            annotation.durationSeconds = this.options.defaultDurationSeconds;
        }
        this.annotations.push(annotation);
        console.log(`Annotation added. Total: ${this.annotations.length}`);
        this.exportAnnotationData();
    }
    _updateAnnotationData(konvaShape) {
        if (!konvaShape || !this.mediaLoaded) return;
        const index = this.annotations.findIndex((ann) => ann.konvaId === konvaShape.id());
        if (index > -1) {
            this.annotations[index].data = this._scaleKonvaDataToNatural(konvaShape);
            this.exportAnnotationData();
        }
    }
    _scaleKonvaDataToNatural(konvaShape) {
        if (!this.scaleFactor) return konvaShape.toObject();
        const scale = this.scaleFactor;
        const data = konvaShape.toObject();
        const scaledData = { ...data };
        ["x", "y", "width", "height", "fontSize", "strokeWidth", "pointerLength", "pointerWidth"].forEach((prop) => {
            if (scaledData[prop] !== undefined) scaledData[prop] /= scale;
        });
        if (scaledData.points) {
            scaledData.points = scaledData.points.map((p) => p / scale);
        }
        scaledData.draggable = false;
        return scaledData;
    }
    _scaleAnnotationDataToRender(naturalData, scaleFactor) {
        if (!scaleFactor) return naturalData;
        const scale = scaleFactor;
        const renderData = { ...naturalData };
        ["x", "y", "width", "height", "fontSize", "strokeWidth", "pointerLength", "pointerWidth"].forEach((prop) => {
            if (renderData[prop] !== undefined) renderData[prop] *= scale;
        });
        if (renderData.points) {
            renderData.points = renderData.points.map((p) => p * scale);
        }
        if (renderData.strokeWidth !== undefined) renderData.strokeWidth = Math.max(1, renderData.strokeWidth);
        if (renderData.fontSize !== undefined) renderData.fontSize = Math.max(1, renderData.fontSize);
        renderData.draggable = this.stage && this.selectedShape && this.selectedShape.id() === renderData.id && this.currentTool === "select";
        return renderData;
    }
    _deleteSelectedAnnotation() {
        if (!this.selectedShape) return;
        const idToDelete = this.selectedShape.id();
        this.annotations = this.annotations.filter((ann) => ann.konvaId !== idToDelete);
        this.selectedShape.destroy();
        this.transformer.nodes([]);
        this.selectedShape = null;
        this.layer.draw();
        console.log(`Annotation deleted. Total: ${this.annotations.length}`);
        this.exportAnnotationData();
    }
    _renderCurrentAnnotations() {
        const currentTime = this.mediaType === "video" ? this.videoEl.currentTime : null;
        this._renderAnnotationsForTime(currentTime, "main");
    }

    _renderAnnotationsForTime(currentTime, target = "main") {
        const { stage, layer, annotations, scaleFactor } =
            target === "preview"
                ? { stage: this.previewStage, layer: this.previewLayer, annotations: this.previewAnnotations, scaleFactor: this.previewVideoEl.clientWidth / this.naturalWidth }
                : { stage: this.stage, layer: this.layer, annotations: this.annotations, scaleFactor: this.scaleFactor };

        if (!stage || !layer || !annotations) return;
        const isImageMode = currentTime === null;
        let needsRedraw = false;
        const threshold = this.options.timeThreshold;
        const konvaShapes = layer.getChildren((node) => !(node instanceof Konva.Transformer));

        konvaShapes.forEach((node) => {
            const annData = annotations.find((a) => a.konvaId === node.id());
            let shouldBeVisible = false;
            if (annData) {
                if (isImageMode) { // Always show for images
                    shouldBeVisible = true;
                } else if (annData.startTime !== undefined) { // Check time for video annotations
                    const duration = annData.durationSeconds || this.options.defaultDurationSeconds; // Use stored or default duration
                    const endTime = annData.startTime + duration;
                    // Show if current time is within [startTime, endTime)
                    shouldBeVisible = currentTime >= annData.startTime && currentTime < endTime;
                } else {
                    shouldBeVisible = Math.abs(annData.time - currentTime) < threshold;
                }
            }
            if (node.isVisible() !== shouldBeVisible) {
                node.visible(shouldBeVisible);
                needsRedraw = true;
                if (!shouldBeVisible && target === "main" && node === this.selectedShape) {
                    node.draggable(false);
                    this.transformer.nodes([]);
                    this.selectedShape = null;
                }
            }
        });
        if (target === "main") {
            if (this.selectedShape && !this.selectedShape.isVisible() && this.transformer.nodes().length > 0) {
                this.selectedShape.draggable(false);
                this.transformer.nodes([]);
                this.selectedShape = null;
                needsRedraw = true;
            } else if (!this.selectedShape && this.transformer.nodes().length > 0) {
                this.transformer.nodes([]);
                needsRedraw = true;
            }
        }
        if (needsRedraw) {
            layer.batchDraw();
        }
    }

    _setActiveTool(tool) {
        this.currentTool = tool;
        Object.entries(this.toolButtons).forEach(([key, button]) => {
            button.classList.toggle("is-active", key === tool);
        });
        this.isDrawing = false;
        this.startPos = null;
        if (this.currentShape) {
            this.currentShape.destroy();
            this.currentShape = null;
            if (this.layer) this.layer.batchDraw();
        }
        if (tool !== "select" && this.selectedShape) {
            this.selectedShape.draggable(false);
            this.transformer.nodes([]);
            this.selectedShape = null;
            if (this.layer) this.layer.batchDraw();
        }
        this._setCursorForTool(tool);
        console.log("Tool:", this.currentTool);
    }
    _setCursorForTool(tool) {
        if (!this.stage || !this.stage.container()) return;
        let cursor = "crosshair";
        if (tool === "select") {
            cursor = "default";
        } else if (tool === "text") {
            cursor = "text";
        }
        this.stage.container().style.cursor = cursor;
    }
    _showLoading(message) {
        this.loadingMessage.textContent = message;
        this.loadingOverlay.classList.remove("is-hidden");
    }
    _hideLoading() {
        this.loadingOverlay.classList.add("is-hidden");
    }

    _recreateKonvaShapesFromData(annotations = this.annotations, targetStage = this.stage, targetLayer = this.layer, isPreview = false, scaleFactor = this.scaleFactor) {
        if (!targetStage || !targetLayer || (!this.mediaLoaded && !isPreview)) return; // Need media loaded for main stage scaling
        targetLayer.getChildren((node) => !(node instanceof Konva.Transformer)).forEach((node) => node.destroy());
        if (!isPreview && this.transformer) this.transformer.nodes([]);
        if (!isPreview) this.selectedShape = null;

        // Use correct scale factor based on target
        const scale = scaleFactor || 1; // Default to 1 if somehow unavailable

        annotations.forEach((annData) => {
            try {
                const renderAttrs = this._scaleAnnotationDataToRender(annData.data, scale); // Scale to target stage size
                const createData = { ...renderAttrs, className: this._getKonvaClassName(annData.type), draggable: false, listening: !isPreview };
                const shape = Konva.Node.create(createData);
                if (shape) {
                    shape.id(annData.konvaId);
                    if (!isPreview) this._addKonvaListeners(shape);
                    targetLayer.add(shape);
                } else console.warn("Failed to recreate shape:", annData);
            } catch (error) {
                console.error("Error recreating shape:", error, annData);
            }
        });
        targetLayer.batchDraw();
        // console.log(`Recreated ${targetLayer.getChildren(node => !(node instanceof Konva.Transformer)).length} shapes on ${isPreview ? 'preview' : 'main'} stage with scale ${scale.toFixed(3)}.`);
    }

    _getKonvaClassName(type) {
        switch (type) {
            case "arrow":
                return "Arrow";
            case "draw":
                return "Line";
            case "text":
                return "Text";
            case "rect-border":
            case "rect-fill":
                return "Rect";
            default:
                return "Shape";
        }
    }

    // Preview Modal Logic
    preview() {
        if (this.mediaType !== "video" || !this.mediaLoaded || !this.videoEl.src) {
            alert("Load a video first.");
            return;
        }
        if (!this.videoEl.paused) {
            alert("Pause the main video before previewing.");
            return;
        }
        console.log("Starting preview...");
        this.previewAnnotations = JSON.parse(JSON.stringify(this.annotations));
        this.previewVideoEl.src = this.videoEl.src;
        this.previewVideoEl.currentTime = this.videoEl.currentTime;
        this.previewVideoEl.onloadedmetadata = () => {
            this.previewVideoEl.onloadedmetadata = null;
            this.previewModal.classList.add("is-active");
            this._setupKonva("preview");
            let lastTime = -1;
            const previewUpdateLoop = () => {
                if (!this.previewStage) {
                    cancelAnimationFrame(this.previewRafId);
                    this.previewRafId = null;
                    return;
                }
                const currentTime = this.previewVideoEl.currentTime;
                if (currentTime !== lastTime) {
                    this._renderAnnotationsForTime(currentTime, "preview");
                    lastTime = currentTime;
                }
                this.previewRafId = requestAnimationFrame(previewUpdateLoop);
            };
            this.previewRafId = requestAnimationFrame(previewUpdateLoop);
            this.previewVideoEl.play();
        };
        this.previewVideoEl.onerror = (e) => {
            console.error("Preview load error:", e);
            alert("Failed to load video for preview.");
            this._closePreviewModal();
        };
        this.previewVideoEl.load();
        console.log("PREVIEW VIDEO ELEMENT: ", this.previewVideoEl);
    }
    _closePreviewModal() {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        console.log("PREVIEW VIDEO ELEMENT:_closePreviewModal ", this.previewVideoEl);
        this.previewVideoEl.pause();
        this.previewVideoEl.removeAttribute("src");
        this.previewVideoEl.load();
        if (this.previewStage) {
            this.previewStage.destroy();
            this.previewStage = null;
            this.previewLayer = null;
        }
        this.previewKonvaContainer.innerHTML = "";
        this.previewModal.classList.remove("is-active");
        this.previewAnnotations = [];
        console.log("Preview closed.");
    }

    // Public functions
    exportAnnotationData() {
        const exportData = { naturalWidth: this.naturalWidth, naturalHeight: this.naturalHeight, mediaType: this.mediaType, annotations: this.annotations };
        const jsonData = JSON.stringify(exportData, null, 2);
        this.jsonOutput.value = jsonData;
        console.log("Annotation data exported.");
        return jsonData;
    }
    saveSnapshot() {
        if (this.mediaType !== "video" || !this.mediaLoaded || !this.stage) {
            alert("Video not loaded.");
            return;
        }
        if (!this.videoEl.paused) {
            alert("Pause video first.");
            return;
        }
        const filename = `annotated_snapshot_${this.videoEl.currentTime.toFixed(1)}s.png`;
        this._saveMediaWithAnnotations(this.videoEl, filename);
    }
    saveImage() {
        if (this.mediaType !== "image" || !this.mediaLoaded || !this.stage) {
            alert("Image not loaded.");
            return;
        }
        const filename = `annotated_image.png`;
        this._saveMediaWithAnnotations(this.imageEl, filename);
    }
    _saveMediaWithAnnotations(mediaElement, downloadFilename) {
        this._showLoading("Generating image...");
        this._renderCurrentAnnotations();
        this.layer.batchDraw();
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = this.renderWidth;
        tempCanvas.height = this.renderHeight;
        const tempCtx = tempCanvas.getContext("2d");
        try {
            tempCtx.drawImage(mediaElement, 0, 0, this.renderWidth, this.renderHeight);
        } catch (e) {
            console.error(`Draw error:`, e);
            alert(`Could not draw ${this.mediaType}.`);
            this._hideLoading();
            return;
        }
        this.stage.toDataURL({
            mimeType: "image/png",
            quality: 1,
            width: this.renderWidth,
            height: this.renderHeight,
            callback: (dataUrl) => {
                if (!dataUrl) {
                    alert("Failed capture annotations.");
                    this._hideLoading();
                    return;
                }
                const overlayImg = new Image();
                overlayImg.onload = () => {
                    tempCtx.drawImage(overlayImg, 0, 0);
                    const finalDataURL = tempCanvas.toDataURL("image/png");
                    const link = document.createElement("a");
                    link.href = finalDataURL;
                    link.download = downloadFilename;
                    link.click();
                    console.log("Media saved:", downloadFilename);
                    this._hideLoading();
                };
                overlayImg.onerror = (err) => {
                    alert("Failed process overlay.");
                    this._hideLoading();
                };
                overlayImg.src = dataUrl;
            },
        });
    }
    loadAnnotations(jsonData) {
        try {
            const data = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;
            if (typeof data !== "object" || !Array.isArray(data.annotations)) throw new Error("Invalid format.");
            if (!this.mediaLoaded && data.naturalWidth && data.naturalHeight) {
                this.naturalWidth = data.naturalWidth;
                this.naturalHeight = data.naturalHeight;
                console.log("Using dimensions from JSON.");
            } else if (this.mediaLoaded && data.naturalWidth && this.naturalWidth !== data.naturalWidth) {
                console.warn(`JSON width differs from media width.`);
            }
            this.clearAllAnnotations(false);
            this.annotations = data.annotations
                .map((ann) => {
                    // Basic validation of structure
            if (ann && ann.konvaId && ann.type && ann.data?.attrs) {
                // Ensure essential geometric properties exist or have defaults if applicable
                // (Example: ensure points exist for lines/arrows)
                 if ((ann.type === 'line' || ann.type === 'arrow') && !ann.data.attrs.points) {
                    console.warn(`Annotation ${ann.konvaId} (${ann.type}) missing points data. Skipping.`);
                    return null;
                }
                 // Ensure time properties have valid numbers or defaults for video
                if (this.mediaType === 'video') {
                    ann.startTime = typeof ann.startTime === 'number' ? Math.floor(ann.startTime) : 0;
                    ann.durationSeconds = typeof ann.durationSeconds === 'number' && ann.durationSeconds > 0 ? ann.durationSeconds : this.options.defaultDurationSeconds;
                }

                // Add default opacity for highlight if missing
                if(ann.type === 'highlight-marker' && ann.data.attrs.opacity === undefined) {
                    ann.data.attrs.opacity = this.options.highlightOpacity;
                }

                return ann; // Keep valid annotation
            } else {
                 console.warn("Skipping invalid annotation structure:", ann);
                 return null; // Discard invalid annotation
            }
                })
                .filter(Boolean);
            console.log(`Loaded ${this.annotations.length} annotations.`);
            if (this.stage && this.layer && this.mediaLoaded) {
                this._recreateKonvaShapesFromData();
                this._renderCurrentAnnotations();
            }
            this.exportAnnotationData();
            this.rightSidebar.classList.add("is-active");
        } catch (error) {
            console.error("Load Annotations Error:", error);
            alert("Failed to load annotations.");
            this.clearAllAnnotations(false);
        }
    }
    clearAllAnnotations(confirmUser = true) {
        if (confirmUser && this.annotations.length > 0 && !confirm("Clear ALL annotations?")) return;
        this.annotations = [];
        if (this.layer) {
            if (this.transformer) this.transformer.nodes([]);
            this.selectedShape = null;
            this.layer.getChildren((node) => !(node instanceof Konva.Transformer)).forEach((node) => node.destroy());
            this.layer.batchDraw();
        }
        this.exportAnnotationData();
        console.log("All cleared.");
    }
    destroy() {
        console.log("Destroying...");
        this._hideLoading();
        this._closePreviewModal();
        if (this.mediaObjectURL) {
            URL.revokeObjectURL(this.mediaObjectURL);
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        clearTimeout(this.resizeTimeout);
        if (this.stage) {
            window.removeEventListener("keydown", this._handleKeyDown);
            this.stage.destroy();
        }
        if (this.videoEl) {
            this.videoEl.pause();
            this.videoEl.removeAttribute("src");
            this.videoEl.load();
        }
        if (this.imageEl) {
            this.imageEl.removeAttribute("src");
        }
        this.stage = null;
        this.layer = null;
        this.transformer = null;
        this.annotations = [];
        this.selectedShape = null;
        this.previewStage = null;
        this.previewLayer = null;
        this.previewAnnotations = [];
        console.log("Cleanup finished.");
    }
}

let annotatorInstance = null;
document.addEventListener("DOMContentLoaded", () => {
    annotatorInstance = new MediaAnnotator({ 
        defaultTool: "select",
        defaultDurationSeconds: 2 // Default annotation display time
     });
    console.log("MediaAnnotator instance created.");
});