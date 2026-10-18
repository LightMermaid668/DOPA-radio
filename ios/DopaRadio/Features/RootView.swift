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
            HomeView()
                .tabItem { Label("ホーム", systemImage: "house.fill") }
                .tag(0)

            DiscoverView()
                .tabItem { Label("ディスカバー", systemImage: "safari.fill") }
                .tag(1)

            LibraryView()
                .tabItem { Label("ライブラリ", systemImage: "music.note.list") }
                .tag(2)

            PlaylistsView()
                .tabItem { Label("プレイリスト", systemImage: "list.bullet.rectangle") }
                .tag(3)

            SearchView()
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
