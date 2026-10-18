import SwiftUI
import AVFoundation

@main
struct DopaRadioApp: App {
    @StateObject private var auth = AuthStore()
    @StateObject private var player = PlayerEngine()

    init() {
        // バックグラウンド再生・ロック画面再生のためのオーディオセッション設定
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            print("[app] audio session error: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(player)
                .preferredColorScheme(.dark)
                .tint(DopaColor.accent)
        }
    }
}

enum DopaColor {
    static let accent = Color(red: 0.91, green: 0.47, blue: 0.98)
    static let background = Color(red: 0.04, green: 0.04, blue: 0.05)
    static let card = Color(red: 0.09, green: 0.09, blue: 0.11)
    static let border = Color(red: 0.15, green: 0.15, blue: 0.18)
    static let rainbow: [Color] = [
        Color(red: 1.0, green: 0.37, blue: 0.43),
        Color(red: 1.0, green: 0.62, blue: 0.26),
        Color(red: 0.97, green: 0.89, blue: 0.39),
        Color(red: 0.29, green: 0.87, blue: 0.50),
        Color(red: 0.22, green: 0.74, blue: 0.97),
        Color(red: 0.65, green: 0.55, blue: 0.98),
        Color(red: 0.96, green: 0.45, blue: 0.71),
    ]
}

struct RainbowText: View {
    let text: String
    var font: Font = .system(size: 28, weight: .black, design: .rounded)

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(
                LinearGradient(colors: DopaColor.rainbow, startPoint: .leading, endPoint: .trailing)
            )
    }
}
