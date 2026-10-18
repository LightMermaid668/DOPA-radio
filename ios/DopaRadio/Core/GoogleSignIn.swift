import Foundation
import GoogleSignIn
import UIKit

/// Googleログイン（ネイティブSDK → Better AuthのidToken方式）
enum GoogleSignInManager {
    /// iOSクライアントIDが設定されているか（未設定ならログイン画面にボタンを出さない）
    static var isConfigured: Bool {
        guard let clientId = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String
        else { return false }
        return !clientId.isEmpty && !clientId.hasPrefix("$(")
    }

    @MainActor
    static func signIn() async throws -> (idToken: String, accessToken: String?) {
        guard isConfigured,
            let clientId = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String
        else {
            throw AuthError.failed("Googleログインが設定されていません")
        }
        let serverClientId =
            (Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String) ?? ""

        // serverClientID（WebクライアントID）を指定すると、IDトークンの aud がサーバー側の
        // クライアントIDになり、Better Authの検証を通せる
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: clientId,
            serverClientID: serverClientId.isEmpty ? nil : serverClientId
        )

        guard let root = rootViewController() else {
            throw AuthError.failed("ログイン画面を表示できません")
        }

        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: root)
            guard let idToken = result.user.idToken?.tokenString else {
                throw AuthError.failed("IDトークンを取得できませんでした")
            }
            return (idToken, result.user.accessToken.tokenString)
        } catch let error as AuthError {
            throw error
        } catch {
            throw AuthError.failed("Googleログインがキャンセルされました")
        }
    }

    private static func rootViewController() -> UIViewController? {
        guard
            let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive })
        else { return nil }
        return scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
    }
}
