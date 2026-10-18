import Foundation

@MainActor
final class AuthStore: ObservableObject {
    @Published private(set) var user: DopaUser?
    @Published private(set) var isChecking = true

    init() {
        Task { await refresh() }
    }

    func refresh() async {
        defer { isChecking = false }
        do {
            let (data, http) = try await APIClient.shared.request("/api/auth/get-session")
            guard (200..<300).contains(http.statusCode) else {
                user = nil
                return
            }
            if let parsed = try? JSONDecoder().decode(SessionResponse.self, from: data) {
                user = parsed.user
            } else {
                user = nil
            }
        } catch {
            // オフライン時などはログイン中のまま維持する
        }
    }

    func signIn(email: String, password: String) async throws {
        struct Body: Encodable {
            let email: String
            let password: String
        }
        let (data, http) = try await APIClient.shared.request(
            "/api/auth/sign-in/email",
            method: "POST",
            body: Body(email: email, password: password)
        )
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw AuthError.failed(body?.message ?? body?.error ?? "ログインに失敗しました")
        }
        await refresh()
        if user == nil {
            throw AuthError.failed("ログインに失敗しました（セッションを取得できません）")
        }
    }

    func signInWithGoogle() async throws {
        let tokens = try await GoogleSignInManager.signIn()

        struct IdTokenBody: Encodable {
            let token: String
            let accessToken: String?
        }
        struct Body: Encodable {
            let provider: String
            let idToken: IdTokenBody
        }

        let (data, http) = try await APIClient.shared.request(
            "/api/auth/sign-in/social",
            method: "POST",
            body: Body(
                provider: "google",
                idToken: IdTokenBody(token: tokens.idToken, accessToken: tokens.accessToken)
            )
        )
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw AuthError.failed(body?.message ?? body?.error ?? "Googleログインに失敗しました")
        }
        await refresh()
        if user == nil {
            throw AuthError.failed("ログインに失敗しました（セッションを取得できません）")
        }
    }

    func signOut() async {
        _ = try? await APIClient.shared.request("/api/auth/sign-out", method: "POST")
        user = nil
    }
}

enum AuthError: Error, LocalizedError {
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .failed(let message): return message
        }
    }
}
