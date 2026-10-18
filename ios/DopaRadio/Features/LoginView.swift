import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore

    @State private var email = ""
    @State private var password = ""
    @State private var isBusy = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            DopaColor.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 60)

                    VStack(spacing: 8) {
                        RainbowText(text: "DOPA-radio", font: .system(size: 34, weight: .black, design: .rounded))
                        Text("ドパガキのための音楽基地")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    VStack(spacing: 12) {
                        TextField("メールアドレス", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(14)
                            .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(DopaColor.border))

                        SecureField("パスワード", text: $password)
                            .textContentType(.password)
                            .padding(14)
                            .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(DopaColor.border))
                            .onSubmit { submit() }
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button(action: submit) {
                        HStack {
                            if isBusy {
                                ProgressView().tint(.black)
                            }
                            Text(isBusy ? "ログイン中…" : "ログイン")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                    }
                    .background(DopaColor.accent, in: Capsule())
                    .foregroundStyle(.black)
                    .disabled(isBusy || email.isEmpty || password.isEmpty)
                    .opacity(email.isEmpty || password.isEmpty ? 0.5 : 1)

                    if GoogleSignInManager.isConfigured {
                        Button(action: submitGoogle) {
                            HStack(spacing: 8) {
                                Image(systemName: "globe")
                                Text("Googleでログイン")
                                    .font(.headline)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                        }
                        .background(DopaColor.card, in: Capsule())
                        .overlay(Capsule().stroke(DopaColor.border))
                        .foregroundStyle(.primary)
                        .disabled(isBusy)
                    }

                    Link(destination: APIClient.baseURL.appendingPathComponent("register")) {
                        Text("アカウントがない場合は Web で新規登録 →")
                            .font(.footnote)
                            .foregroundStyle(DopaColor.accent)
                    }

                    Spacer(minLength: 40)
                }
                .padding(.horizontal, 24)
            }
        }
    }

    private func submit() {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        let emailValue = email.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                try await auth.signIn(email: emailValue, password: password)
            } catch {
                errorMessage = error.localizedDescription
            }
            isBusy = false
        }
    }

    private func submitGoogle() {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        Task {
            do {
                try await auth.signInWithGoogle()
            } catch {
                errorMessage = error.localizedDescription
            }
            isBusy = false
        }
    }
}
