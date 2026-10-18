import Foundation

/// サーバーAPIクライアント。セッションCookieはURLSessionがアプリ内で永続保持する。
final class APIClient {
    static let baseURL = URL(string: "https://dopa-radio.sosukeiwasaki.f5.si")!
    static let shared = APIClient()

    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        session = URLSession(configuration: config)
    }

    private var userAgent: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        return "DOPA-radio-iOS/\(version)"
    }

    func request(
        _ path: String,
        method: String = "GET",
        body: Encodable? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: URL(string: path, relativeTo: APIClient.baseURL)!)
        request.httpMethod = method
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(APIClient.baseURL.absoluteString, forHTTPHeaderField: "Origin")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return (data, http)
    }

    func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        let (data, http) = try await request(path)
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func post<T: Decodable>(_ path: String, body: Encodable, as type: T.Type) async throws -> T {
        let (data, http) = try await request(path, method: "POST", body: body)
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// レスポンス本文を使わない送信（PATCH / DELETE など）
    @discardableResult
    func send(_ path: String, method: String, body: Encodable? = nil) async throws -> HTTPURLResponse {
        let (_, http) = try await request(path, method: method, body: body)
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
        return http
    }

    /// 画像などのバイナリ取得
    nonisolated func fetchData(_ url: URL) async -> Data? {
        var request = URLRequest(url: url)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        return try? await URLSession.shared.data(for: request).0
    }
}

enum APIError: Error, LocalizedError {
    case invalidResponse
    case status(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "サーバーの応答が不正です"
        case .status(let code):
            return "通信エラー（\(code)）"
        }
    }
}

struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        encodeFunc = { encoder in try wrapped.encode(to: encoder) }
    }

    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}
