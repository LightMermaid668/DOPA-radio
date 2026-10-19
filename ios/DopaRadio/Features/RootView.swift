#if canImport(GoogleSignIn)
import GoogleSignIn
#endif
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
                #if os(macOS)
                MacShellView()
                #else
                mainTabs
                #endif
            }
        }
        .preferredColorScheme(.dark)
        .onOpenURL { url in
            // Googleログインの戻り（OAuthコールバック）
            #if canImport(GoogleSignIn)
            GIDSignIn.sharedInstance.handle(url)
            #endif
        }
    }

    private var mainTabs: some View {
        Group {
            #if os(iOS)
            if #available(iOS 26.0, *) {
                // iOS 26+: システムのタブバーアクセサリとしてミニプレイヤーを表示。
                // リストの下部インセットが自動調整される（Apple Music風・タブバーに吸い込まれる）
                TabView(selection: $selectedTab) {
                    tabItems
                }
                .tabViewBottomAccessory {
                    if player.currentTrack != nil {
                        MiniPlayerBar(showNowPlaying: $showNowPlaying, embedded: true)
                    }
                }
                .tabBarMinimizeBehavior(.onScrollDown)
            } else {
                legacyTabs
            }
            #else
            legacyTabs
            #endif
        }
        .sheet(isPresented: $showNowPlaying) {
            nowPlayingSheet
        }
        .tint(DopaColor.accent)
    }

    private var legacyTabs: some View {
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
    }

    @ViewBuilder
    private var nowPlayingSheet: some View {
        #if os(iOS)
        NowPlayingView()
            .environmentObject(player)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(24)
            .presentationBackground(DopaColor.background)
        #else
        NowPlayingView()
            .environmentObject(player)
            .frame(minWidth: 420, idealWidth: 480, minHeight: 620, idealHeight: 720)
        #endif
    }

    @ViewBuilder
    private var tabItems: some View {
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
