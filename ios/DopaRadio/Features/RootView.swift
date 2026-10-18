import SwiftUI

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var player: PlayerEngine
    @State private var selectedTab = 2
    @State private var showNowPlaying = false

    var body: some View {
        Group {
            if auth.isChecking {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(DopaColor.background.ignoresSafeArea())
            } else if auth.user == nil {
                LoginView()
            } else {
                mainTabs
            }
        }
        .preferredColorScheme(.dark)
    }

    private var mainTabs: some View {
        TabView(selection: $selectedTab) {
            PlaceholderView(title: "ホーム", message: "ピン留め・保存した曲・タブのハブ（Phase 2以降）", systemImage: "house.fill")
                .tabItem { Label("ホーム", systemImage: "house.fill") }
                .tag(0)

            PlaceholderView(title: "ディスカバー", message: "みんなの公開曲とプレイリスト（Phase 2で実装）", systemImage: "safari.fill")
                .tabItem { Label("ディスカバー", systemImage: "safari.fill") }
                .tag(1)

            LibraryView()
                .tabItem { Label("ライブラリ", systemImage: "music.note.list") }
                .tag(2)

            PlaceholderView(title: "プレイリスト", message: "プレイリスト一覧と詳細（Phase 2で実装）", systemImage: "list.bullet.rectangle")
                .tabItem { Label("プレイリスト", systemImage: "list.bullet.rectangle") }
                .tag(3)

            PlaceholderView(title: "検索", message: "ライブラリ/ディスカバーの検索（Phase 2で実装）", systemImage: "magnifyingglass")
                .tabItem { Label("検索", systemImage: "magnifyingglass") }
                .tag(4)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if player.currentTrack != nil {
                MiniPlayerBar(showNowPlaying: $showNowPlaying)
            }
        }
        .fullScreenCover(isPresented: $showNowPlaying) {
            NowPlayingView()
                .environmentObject(player)
        }
        .tint(DopaColor.accent)
    }
}

struct PlaceholderView: View {
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 40))
                    .foregroundStyle(.tertiary)
                Text(title)
                    .font(.headline)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(DopaColor.background)
            .navigationTitle(title)
        }
    }
}
