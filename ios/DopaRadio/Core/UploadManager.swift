import Foundation

/// アップロードの進行状態
enum UploadPhase: Equatable {
    case idle
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

    @Published var rightsConfirmed = false
    @Published var visibility = "public"

    private var importedURL: URL?

    var isBusy: Bool {
        switch phase {
        case .preparing, .uploading, .committing: return true
        default: return false
        }
    }

    var canUpload: Bool {
        importedURL != nil && rightsConfirmed && !isBusy
    }

    func reset() {
        phase = .idle
        fileName = nil
        fileSizeBytes = 0
        importedURL = nil
    }

    /// ファイルピッカーで選ばれたURLを取り込む（セキュリティスコープ対応）
    func importFile(_ url: URL) {
        do {
            let accessed = url.startAccessingSecurityScopedResource()
            defer {
                if accessed { url.stopAccessingSecurityScopedResource() }
            }
            let temp = FileManager.default.temporaryDirectory
                .appendingPathComponent("dopa-upload-\(UUID().uuidString)-\(url.lastPathComponent)")
            try? FileManager.default.removeItem(at: temp)
            try FileManager.default.copyItem(at: url, to: temp)
            let attributes = try FileManager.default.attributesOfItem(atPath: temp.path)
            let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0

            importedURL = temp
            fileName = url.lastPathComponent
            fileSizeBytes = size
            phase = .idle
        } catch {
            phase = .failed("ファイルを読み込めませんでした")
        }
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
