#if os(macOS)
import Foundation

/// Stable Audio 3.0（MLX）の導入・生成を管理する（Mac限定・完全ローカル）
///
/// - 初回セットアップ: コード取得 → uv導入 → Python環境 → 重みをアプリ内DL
/// - 生成: `.venv` の Python で sa3_mlx.py を実行し、44.1kHz WAV を得る
@MainActor
final class StableAudioManager: ObservableObject {
    static let shared = StableAudioManager()

    // MARK: - 型

    enum SetupPhase: Equatable {
        case checking
        case needsSetup
        case settingUp
        case ready
    }

    enum ModelBundle: String, CaseIterable, Identifiable {
        case smallMusic = "sm-music"
        case medium = "medium"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .smallMusic: return "Small（高速・最大120秒）"
            case .medium: return "Medium（高品質・最大380秒）"
            }
        }

        var sizeLabel: String {
            switch self {
            case .smallMusic: return "約1.8GB"
            case .medium: return "約6.2GB"
            }
        }

        var decoder: String {
            switch self {
            case .smallMusic: return "same-s"
            case .medium: return "same-l"
            }
        }

        var maxSeconds: Int {
            switch self {
            case .smallMusic: return 120
            case .medium: return 380
            }
        }
    }

    struct WeightFile {
        let fileName: String
        let hfPath: String
        let approxBytes: Int64
    }

    struct GenerationRequest {
        var prompt: String
        var negativePrompt: String = ""
        var bundle: ModelBundle = .smallMusic
        var seconds: Int = 60
        var steps: Int = 8
        var cfg: Double = 1.0
        var seed: Int?
        var title: String = ""
    }

    // MARK: - 定数

    static let hfRepo = "stabilityai/stable-audio-3-optimized"
    static let repoURL = "https://github.com/Stability-AI/stable-audio-3"

    static let sharedBundle: [WeightFile] = [
        WeightFile(
            fileName: "t5gemma_f16.npz",
            hfPath: "MLX/t5gemma_f16.npz",
            approxBytes: 541_000_000
        )
    ]

    static let smallBundle: [WeightFile] = [
        WeightFile(
            fileName: "dit_sm-music_f16.npz",
            hfPath: "MLX/dit_sm-music_f16.npz",
            approxBytes: 877_000_000
        ),
        WeightFile(
            fileName: "same_s_decoder_f32.npz",
            hfPath: "MLX/same_s_decoder_f32.npz",
            approxBytes: 210_000_000
        ),
        WeightFile(
            fileName: "same_s_encoder_f32.npz",
            hfPath: "MLX/same_s_encoder_f32.npz",
            approxBytes: 210_000_000
        ),
    ]

    static let mediumBundle: [WeightFile] = [
        WeightFile(
            fileName: "dit_medium_f16.npz",
            hfPath: "MLX/dit_medium_f16.npz",
            approxBytes: 2_770_000_000
        ),
        WeightFile(
            fileName: "same_l_decoder_f32.npz",
            hfPath: "MLX/same_l_decoder_f32.npz",
            approxBytes: 1_700_000_000
        ),
        WeightFile(
            fileName: "same_l_encoder_f32.npz",
            hfPath: "MLX/same_l_encoder_f32.npz",
            approxBytes: 1_700_000_000
        ),
    ]

    // MARK: - パス

    static var supportDir: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DOPA-radio/StableAudio", isDirectory: true)
    }

    var repoDir: URL { Self.supportDir.appendingPathComponent("repo", isDirectory: true) }
    var projectDir: URL { repoDir.appendingPathComponent("optimized/mlx", isDirectory: true) }
    var modelsDir: URL { projectDir.appendingPathComponent("models/mlx", isDirectory: true) }
    var uvBinary: URL { Self.supportDir.appendingPathComponent("bin/uv") }
    var venvPython: URL { projectDir.appendingPathComponent(".venv/bin/python") }

    static var outputDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DOPA-AI", isDirectory: true)
    }

    // MARK: - 状態

    @Published private(set) var phase: SetupPhase = .checking
    @Published private(set) var stepLabel = ""
    @Published private(set) var stepProgress: Double?
    @Published private(set) var logLines: [String] = []
    @Published private(set) var installedBundles: Set<ModelBundle> = []
    @Published private(set) var isGenerating = false
    @Published private(set) var generationElapsed: Double = 0
    @Published var lastError: String?

    private var setupTask: Task<Void, Never>?

    private init() {
        refresh()
    }

    // MARK: - 状態チェック

    func refresh() {
        var installed: Set<ModelBundle> = []
        if filesExist(Self.smallBundle + Self.sharedBundle) {
            installed.insert(.smallMusic)
        }
        if filesExist(Self.mediumBundle + Self.sharedBundle) {
            installed.insert(.medium)
        }
        installedBundles = installed

        let hasRuntime =
            FileManager.default.fileExists(atPath: venvPython.path)
            && FileManager.default.fileExists(
                atPath: projectDir.appendingPathComponent("scripts/sa3_mlx.py").path
            )
        if hasRuntime && !installed.isEmpty {
            phase = .ready
        } else if phase != .settingUp {
            phase = .needsSetup
        }
    }

    private func filesExist(_ files: [WeightFile]) -> Bool {
        files.allSatisfy {
            FileManager.default.fileExists(atPath: modelsDir.appendingPathComponent($0.fileName).path)
        }
    }

    static func availableDiskSpace() -> Int64? {
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage
    }

    // MARK: - セットアップ

    func startSetup(downloadMedium: Bool) {
        guard setupTask == nil else { return }
        phase = .settingUp
        lastError = nil
        setupTask = Task { [weak self] in
            await self?.runSetup(downloadMedium: downloadMedium)
            self?.setupTask = nil
        }
    }

    /// Mediumを後から追加
    func installMedium() {
        guard setupTask == nil else { return }
        phase = .settingUp
        lastError = nil
        setupTask = Task { [weak self] in
            guard let self else { return }
            do {
                try self.createDirectories()
                try await self.downloadWeights(Self.mediumBundle, label: "Mediumモデル")
                self.appendLog("Mediumモデルを追加しました")
            } catch {
                self.lastError = error.localizedDescription
                self.appendLog("エラー: \(error.localizedDescription)")
            }
            self.refresh()
            if self.phase == .settingUp { self.phase = .needsSetup }
            self.setupTask = nil
        }
    }

    func deleteBundle(_ bundle: ModelBundle) {
        let files = bundle == .medium ? Self.mediumBundle : Self.smallBundle
        for file in files {
            try? FileManager.default.removeItem(at: modelsDir.appendingPathComponent(file.fileName))
        }
        refresh()
        appendLog("\(bundle.label) のモデルを削除しました")
    }

    private func runSetup(downloadMedium: Bool) async {
        do {
            try createDirectories()
            try await ensureRepoCode()
            try await ensureUV()
            try await ensureVenv()
            try await downloadWeights(Self.sharedBundle, label: "共通モデル")
            try await downloadWeights(Self.smallBundle, label: "Smallモデル")
            if downloadMedium {
                try await downloadWeights(Self.mediumBundle, label: "Mediumモデル")
            }
            await downloadLegalFiles()
            appendLog("セットアップが完了しました")
            refresh()
            if phase == .settingUp { phase = .ready }
        } catch {
            lastError = error.localizedDescription
            appendLog("エラー: \(error.localizedDescription)")
            phase = .needsSetup
        }
    }

    private func createDirectories() throws {
        for url in [Self.supportDir, modelsDir, Self.outputDirectory] {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }

    // MARK: セットアップ手順

    private func ensureRepoCode() async throws {
        let marker = projectDir.appendingPathComponent("scripts/sa3_mlx.py")
        if FileManager.default.fileExists(atPath: marker.path) { return }

        setStep("コードを取得中…（git clone）", nil)
        if FileManager.default.fileExists(atPath: repoDir.path) {
            try? FileManager.default.removeItem(at: repoDir)
        }
        do {
            try await runProcess(
                "/usr/bin/git",
                [
                    "clone", "--depth", "1", "--filter=blob:none", "--sparse",
                    Self.repoURL, repoDir.path,
                ],
                cwd: Self.supportDir, label: "git"
            )
            try await runProcess(
                "/usr/bin/git", ["sparse-checkout", "set", "optimized/mlx"],
                cwd: repoDir, label: "git"
            )
        } catch {
            appendLog("sparse cloneに失敗。通常cloneで再試行します")
            if FileManager.default.fileExists(atPath: repoDir.path) {
                try? FileManager.default.removeItem(at: repoDir)
            }
            try await runProcess(
                "/usr/bin/git", ["clone", "--depth", "1", Self.repoURL, repoDir.path],
                cwd: Self.supportDir, label: "git"
            )
        }
        guard FileManager.default.fileExists(atPath: marker.path) else {
            throw StableAudioError.setupFailed("コードの取得に失敗しました")
        }
        appendLog("コードを取得しました")
    }

    private func ensureUV() async throws {
        if FileManager.default.fileExists(atPath: uvBinary.path) { return }

        setStep("ランタイム(uv)を取得中…", 0)
        let tarball = Self.supportDir.appendingPathComponent("uv-aarch64-apple-darwin.tar.gz")
        guard
            let url = URL(
                string:
                    "https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz"
            )
        else { throw StableAudioError.setupFailed("uvのURLが不正です") }
        try? FileManager.default.removeItem(at: tarball)
        try await downloadFile(url: url, to: tarball) { [weak self] ratio in
            Task { @MainActor in self?.setProgress(ratio) }
        }

        try await runProcess(
            "/usr/bin/tar", ["-xzf", tarball.path, "-C", Self.supportDir.path],
            cwd: Self.supportDir, label: "tar"
        )
        let extracted = Self.supportDir.appendingPathComponent("uv-aarch64-apple-darwin/uv")
        try FileManager.default.createDirectory(
            at: uvBinary.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try? FileManager.default.removeItem(at: uvBinary)
        try FileManager.default.moveItem(at: extracted, to: uvBinary)
        try? FileManager.default.removeItem(at: tarball)
        try? FileManager.default.removeItem(
            at: Self.supportDir.appendingPathComponent("uv-aarch64-apple-darwin")
        )
        appendLog("uv を導入しました")
    }

    private func ensureVenv() async throws {
        if FileManager.default.fileExists(atPath: venvPython.path) { return }

        setStep("Python 3.11 環境を構築中…", nil)
        try await runProcess(
            uvBinary.path, ["venv", "--python", "3.11", ".venv"],
            cwd: projectDir, label: "uv"
        )
        setStep("依存ライブラリをインストール中…", nil)
        try await runProcess(
            uvBinary.path, ["pip", "install", "-r", "requirements.txt"],
            cwd: projectDir, label: "uv"
        )
        guard FileManager.default.fileExists(atPath: venvPython.path) else {
            throw StableAudioError.setupFailed("Python環境の構築に失敗しました")
        }
        appendLog("Python環境を構築しました")
    }

    private func downloadWeights(_ files: [WeightFile], label: String) async throws {
        try FileManager.default.createDirectory(at: modelsDir, withIntermediateDirectories: true)
        for (index, file) in files.enumerated() {
            let destination = modelsDir.appendingPathComponent(file.fileName)
            if FileManager.default.fileExists(atPath: destination.path) { continue }
            setStep("\(label)をダウンロード中…（\(index + 1)/\(files.count)）", 0)
            guard
                let url = URL(
                    string: "https://huggingface.co/\(Self.hfRepo)/resolve/main/\(file.hfPath)"
                )
            else { throw StableAudioError.setupFailed("重みのURLが不正です: \(file.fileName)") }

            let temporary = modelsDir.appendingPathComponent(file.fileName + ".partial")
            try? FileManager.default.removeItem(at: temporary)
            try await downloadFile(url: url, to: temporary) { [weak self] ratio in
                Task { @MainActor in self?.setProgress(ratio) }
            }
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: temporary, to: destination)
            appendLog("ダウンロード完了: \(file.fileName)")
        }
    }

    private func downloadLegalFiles() async {
        for (remote, local) in [("LICENSE.md", "LICENSE.md"), ("NOTICE", "NOTICE")] {
            let destination = Self.supportDir.appendingPathComponent(local)
            if FileManager.default.fileExists(atPath: destination.path) { continue }
            guard
                let url = URL(string: "https://huggingface.co/\(Self.hfRepo)/resolve/main/\(remote)")
            else { continue }
            try? await downloadFile(url: url, to: destination) { _ in }
        }
    }

    // MARK: - 生成

    func generate(_ request: GenerationRequest) async throws -> URL {
        guard phase == .ready else { throw StableAudioError.notInstalled }
        guard !isGenerating else { throw StableAudioError.busy }
        guard installedBundles.contains(request.bundle) else {
            throw StableAudioError.notInstalled
        }

        isGenerating = true
        generationElapsed = 0
        lastError = nil
        defer { isGenerating = false }

        try createDirectories()
        let base = request.title.isEmpty ? "ドパAI \(Self.timestamp())" : request.title
        let outputURL = Self.outputDirectory.appendingPathComponent("\(Self.sanitize(base)).wav")
        try? FileManager.default.removeItem(at: outputURL)

        var arguments = [
            "scripts/sa3_mlx.py",
            "--prompt", request.prompt,
            "--dit", request.bundle.rawValue,
            "--decoder", request.bundle.decoder,
            "--seconds", String(request.seconds),
            "--steps", String(request.steps),
            "--out", outputURL.path,
        ]
        if abs(request.cfg - 1.0) > 0.001 {
            arguments += ["--cfg", String(request.cfg)]
            if !request.negativePrompt.isEmpty {
                arguments += ["--negative-prompt", request.negativePrompt]
            }
        }
        if let seed = request.seed {
            arguments += ["--seed", String(seed)]
        }

        appendLog("生成開始: \(request.bundle.rawValue) / \(request.seconds)秒 / \(request.steps)ステップ")
        let startedAt = Date()
        let timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard let self, !Task.isCancelled else { return }
                self.generationElapsed = Date().timeIntervalSince(startedAt)
            }
        }
        defer { timer.cancel() }

        try await runProcess(venvPython.path, arguments, cwd: projectDir, label: "sa3")

        guard FileManager.default.fileExists(atPath: outputURL.path) else {
            throw StableAudioError.generationFailed
        }
        appendLog(
            String(
                format: "生成完了（%.1f秒）: %@",
                Date().timeIntervalSince(startedAt),
                outputURL.lastPathComponent
            )
        )
        return outputURL
    }

    // MARK: - プロセス実行

    @discardableResult
    private func runProcess(
        _ executable: String,
        _ arguments: [String],
        cwd: URL,
        label: String
    ) async throws -> Int32 {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            process.currentDirectoryURL = cwd

            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] =
                "\(Self.supportDir.appendingPathComponent("bin").path):/usr/bin:/bin:/usr/sbin:/sbin"
            environment["UV_PYTHON_INSTALL_DIR"] =
                Self.supportDir.appendingPathComponent("python").path
            process.environment = environment

            let outputPipe = Pipe()
            let errorPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = errorPipe

            let emitter = StreamLineEmitter { [weak self] line in
                Task { @MainActor in
                    self?.appendLog("[\(label)] \(line)")
                }
            }
            outputPipe.fileHandleForReading.readabilityHandler = { handle in
                emitter.ingest(handle.availableData)
            }
            errorPipe.fileHandleForReading.readabilityHandler = { handle in
                emitter.ingest(handle.availableData)
            }

            process.terminationHandler = { finished in
                outputPipe.fileHandleForReading.readabilityHandler = nil
                errorPipe.fileHandleForReading.readabilityHandler = nil
                if finished.terminationStatus == 0 {
                    continuation.resume(returning: finished.terminationStatus)
                } else {
                    continuation.resume(
                        throwing: StableAudioError.processFailed(label, finished.terminationStatus)
                    )
                }
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - ダウンロード

    private func downloadFile(
        url: URL,
        to destination: URL,
        progress: @escaping @Sendable (Double) -> Void
    ) async throws {
        let holder = SessionHolder()
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            let delegate = DownloadDelegate(
                destination: destination,
                progress: progress
            ) { error in
                _ = holder // 完了までセッションを保持する
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
            let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
            holder.session = session
            holder.delegate = delegate
            session.downloadTask(with: url).resume()
        }
    }

    // MARK: - ログ

    private func setStep(_ label: String, _ progress: Double?) {
        stepLabel = label
        stepProgress = progress
    }

    private func setProgress(_ ratio: Double) {
        stepProgress = min(1, max(0, ratio))
    }

    private func appendLog(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        logLines.append(trimmed)
        if logLines.count > 400 {
            logLines.removeFirst(logLines.count - 400)
        }
    }

    private static func sanitize(_ name: String) -> String {
        name
            .replacingOccurrences(of: "/", with: "／")
            .replacingOccurrences(of: ":", with: "：")
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMdd-HHmm"
        return formatter.string(from: Date())
    }
}

// MARK: - 保持用ホルダー

private final class SessionHolder {
    var session: URLSession?
    var delegate: DownloadDelegate?
}

// MARK: - ダウンロードデリゲート

private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
    let destination: URL
    let progress: @Sendable (Double) -> Void
    private let completion: @Sendable (Error?) -> Void
    private let lock = NSLock()
    private var finished = false

    init(
        destination: URL,
        progress: @escaping @Sendable (Double) -> Void,
        completion: @escaping @Sendable (Error?) -> Void
    ) {
        self.destination = destination
        self.progress = progress
        self.completion = completion
    }

    private func finish(_ error: Error?) {
        lock.lock()
        let alreadyDone = finished
        finished = true
        lock.unlock()
        guard !alreadyDone else { return }
        completion(error)
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        progress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            finish(error)
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        session.finishTasksAndInvalidate()
        finish(error)
    }
}

// MARK: - 出力の行分割

private final class StreamLineEmitter: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = ""
    private let onLine: @Sendable (String) -> Void

    init(onLine: @escaping @Sendable (String) -> Void) {
        self.onLine = onLine
    }

    func ingest(_ data: Data) {
        guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
        lock.lock()
        buffer += text
        var lines: [String] = []
        while let range = buffer.range(of: "\n") {
            lines.append(String(buffer[buffer.startIndex..<range.lowerBound]))
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
        }
        lock.unlock()
        for line in lines {
            onLine(line)
        }
    }
}

// MARK: - エラー

enum StableAudioError: LocalizedError {
    case notInstalled
    case busy
    case generationFailed
    case processFailed(String, Int32)
    case setupFailed(String)

    var errorDescription: String? {
        switch self {
        case .notInstalled:
            return "Stable Audio 3 のモデルが未導入です。セットアップを実行してください"
        case .busy:
            return "別の生成が進行中です"
        case .generationFailed:
            return "音声ファイルが生成されませんでした"
        case .processFailed(let label, let code):
            return "\(label) が失敗しました（終了コード \(code)）。ログを確認してください"
        case .setupFailed(let message):
            return message
        }
    }
}
#endif
