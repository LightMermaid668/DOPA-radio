import GoogleSignIn
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
        .onOpenURL { url in
            // Googleログインの戻り（OAuthコールバック）
            GIDSignIn.sharedInstance.handle(url)
        }
    }

    private var mainTabs: some View {
        TabView(selection: $selectedTab) {
            playerTab { HomeView() }
                .tabItem { Label("ホーム", systemImage: "house.fill") }
                .tag(0)

            playerTab { DiscoverView() }
                .tabItem { Label("ディスカバー", systemImage: "safari.fill") }
                .tag(1)

            playerTab { LibraryView() }
                .tabItem { Label("ライブラリ", systemImage: "music.note.list") }
                .tag(2)

            playerTab { PlaylistsView() }
                .tabItem { Label("プレイリスト", systemImage: "list.bullet.rectangle") }
                .tag(3)

            playerTab { SearchView() }
                .tabItem { Label("検索", systemImage: "magnifyingglass") }
                .tag(4)
        }
        .sheet(isPresented: $showNowPlaying) {
            NowPlayingView()
                .environmentObject(player)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(24)
                .presentationBackground(DopaColor.background)
        }
        .tint(DopaColor.accent)
    }

    /// タブ内容の下端（タブバーの上）にミニプレイヤーを重ねる。
    /// TabView 全体に付けるとタブバーを覆ってしまうため、各タブ内容に付ける。
    private func playerTab<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if player.currentTrack != nil {
                    MiniPlayerBar(showNowPlaying: $showNowPlaying)
                }
            }
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
