import AVFoundation
import Foundation

/// アップロードの進行状態
enum UploadPhase: Equatable {
    case idle
    case compressing(Double)
    case preparing
    case uploading(Double)
    case committing
    case done
    case failed(String)
}

/// ネイティブからの曲アップロード（presign → S3へPUT → commit）
@MainActor
final class UploadManager: ObservableObject {
    @Published private(set) var phase: UploadPhase = .idle
    @Published private(set) var fileName: String?
    @Published private(set) var fileSizeBytes: Int64 = 0
    @Published private(set) var originalSizeBytes: Int64 = 0

    /// 100MB超のときに出す「圧縮するか」確認
    struct OversizePrompt: Identifiable, Equatable {
        let id = UUID()
        let fileName: String
        let sizeBytes: Int64
        let bitrate: Int
        let estimatedBytes: Int64
        let duration: Double
    }

    @Published var oversizePrompt: OversizePrompt?

    static let uploadLimitBytes: Int64 = 100 * 1024 * 1024
    private var pendingOriginalTemp: URL?

    @Published var rightsConfirmed = false
    @Published var visibility = "public"

    private var importedURL: URL?

    var isBusy: Bool {
        switch phase {
        case .preparing, .uploading, .committing, .compressing: return true
        default: return false
        }
    }

    var canUpload: Bool {
        importedURL != nil && rightsConfirmed && !isBusy
    }

    func reset() {
        if let pendingOriginalTemp {
            try? FileManager.default.removeItem(at: pendingOriginalTemp)
        }
        pendingOriginalTemp = nil
        oversizePrompt = nil
        phase = .idle
        fileName = nil
        fileSizeBytes = 0
        originalSizeBytes = 0
        importedURL = nil
    }

    /// ファイルピッカーで選ばれたURLを取り込む（セキュリティスコープ対応）
    /// 100MBを超える場合は圧縮確認（oversizePrompt）を出す
    func importFile(_ url: URL) async {
        phase = .preparing
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }

        let originalTemp: URL
        do {
            originalTemp = FileManager.default.temporaryDirectory
                .appendingPathComponent("dopa-upload-\(UUID().uuidString)-\(url.lastPathComponent)")
            try? FileManager.default.removeItem(at: originalTemp)
            try FileManager.default.copyItem(at: url, to: originalTemp)
        } catch {
            phase = .failed("ファイルを読み込めませんでした")
            return
        }

        let size =
            ((try? FileManager.default.attributesOfItem(atPath: originalTemp.path))?[.size] as? NSNumber)?
            .int64Value ?? 0
        originalSizeBytes = size
        fileSizeBytes = size
        fileName = url.lastPathComponent

        guard size > Self.uploadLimitBytes else {
            importedURL = originalTemp
            phase = .idle
            return
        }

        // アップロード上限を超えている → 圧縮するか確認
        let asset = AVURLAsset(url: originalTemp)
        let duration = (try? await asset.load(.duration).seconds) ?? 0
        guard duration > 0 else {
            try? FileManager.default.removeItem(at: originalTemp)
            phase = .failed("音源の長さを取得できませんでした")
            return
        }
        let bitrate = Self.bitrateToFit(duration: duration)
        let estimate = AudioCompressor.estimatedBytes(duration: duration, bitrate: bitrate)
        pendingOriginalTemp = originalTemp
        oversizePrompt = OversizePrompt(
            fileName: url.lastPathComponent,
            sizeBytes: size,
            bitrate: bitrate,
            estimatedBytes: estimate,
            duration: duration
        )
        phase = .idle
    }

    /// 100MB以内に収まる最高ビットレートを選ぶ
    private static func bitrateToFit(duration: Double) -> Int {
        let usable = Double(uploadLimitBytes) * 0.95
        let needed = Int(usable * 8 / max(duration, 1))
        for candidate in [256_000, 192_000, 128_000, 96_000, 64_000] where candidate <= needed {
            return candidate
        }
        return 64_000
    }

    func confirmCompression() async {
        guard let prompt = oversizePrompt, let source = pendingOriginalTemp else { return }
        oversizePrompt = nil
        phase = .compressing(0)
        do {
            let compressed = try await AudioCompressor.compress(
                source: source,
                bitrate: prompt.bitrate
            ) { [weak self] ratio in
                Task { @MainActor in
                    self?.phase = .compressing(ratio)
                }
            }
            let originalName = fileName ?? prompt.fileName
            let newName = (originalName as NSString).deletingPathExtension + ".m4a"
            let newSize =
                ((try? FileManager.default.attributesOfItem(atPath: compressed.path))?[.size] as? NSNumber)?
                .int64Value ?? 0
            try? FileManager.default.removeItem(at: source)
            pendingOriginalTemp = nil
            importedURL = compressed
            fileName = newName
            fileSizeBytes = newSize
            phase = .idle
        } catch {
            try? FileManager.default.removeItem(at: source)
            pendingOriginalTemp = nil
            importedURL = nil
            phase = .failed(error.localizedDescription)
        }
    }

    func cancelCompression() {
        if let pendingOriginalTemp {
            try? FileManager.default.removeItem(at: pendingOriginalTemp)
        }
        pendingOriginalTemp = nil
        oversizePrompt = nil
        importedURL = nil
        fileName = nil
        fileSizeBytes = 0
        originalSizeBytes = 0
        phase = .idle
    }

    func upload() async {
        guard let fileURL = importedURL, let name = fileName, canUpload else { return }

        phase = .preparing
        do {
            // 1) presign（サーバー側でトラック行が作成される）
            struct PresignBody: Encodable {
                let filename: String
                let size: Int64
                let rightsConfirmed: Bool
                let visibility: String
            }
            struct PresignResponse: Decodable {
                let trackId: String
                let uploadUrl: String
                let contentType: String
            }
            let presign: PresignResponse = try await postJSON(
                "/api/uploads/presign",
                body: PresignBody(
                    filename: name,
                    size: fileSizeBytes,
                    rightsConfirmed: true,
                    visibility: visibility
                )
            )

            // 2) S3（Garage）へ直接PUT
            guard let putURL = URL(string: presign.uploadUrl) else {
                throw UploadError.message("アップロード先が不正です")
            }
            phase = .uploading(0)
            var request = URLRequest(url: putURL)
            request.httpMethod = "PUT"
            request.setValue(presign.contentType, forHTTPHeaderField: "Content-Type")

            let delegate = UploadProgressDelegate { ratio in
                Task { @MainActor [weak self] in
                    guard let self, case .uploading = self.phase else { return }
                    self.phase = .uploading(ratio)
                }
            }
            let (_, response) = try await URLSession.shared.upload(
                for: request, fromFile: fileURL, delegate: delegate
            )
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
            else {
                throw UploadError.message("アップロードに失敗しました")
            }

            // 3) commit（変換キューへ）
            phase = .committing
            let _: EmptyResponse = try await postJSON(
                "/api/tracks/\(presign.trackId)/commit", body: EmptyBody()
            )

            phase = .done
        } catch let error as UploadError {
            phase = .failed(error.message)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    // MARK: - ヘルパー

    private struct EmptyBody: Encodable {}
    private struct EmptyResponse: Decodable {
        init(from decoder: Decoder) throws {}
    }

    private func postJSON<Body: Encodable, Response: Decodable>(
        _ path: String,
        body: Body
    ) async throws -> Response {
        let (data, http) = try await APIClient.shared.request(path, method: "POST", body: body)
        guard (200..<300).contains(http.statusCode) else {
            let errorBody = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw UploadError.message(errorBody?.error ?? "サーバーエラー（\(http.statusCode)）")
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}

enum UploadError: Error {
    case message(String)

    var message: String {
        switch self {
        case .message(let text): return text
        }
    }
}

private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate {
    private let onProgress: @Sendable (Double) -> Void

    init(onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard totalBytesExpectedToSend > 0 else { return }
        onProgress(Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }
}
