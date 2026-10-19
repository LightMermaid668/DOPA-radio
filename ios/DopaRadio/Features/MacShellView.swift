#if os(macOS)
import AVKit
import SwiftUI

/// Macのサイドバー項目
enum MacSection: String, CaseIterable, Identifiable {
    case home, discover, library, playlists, search, downloads, compose, settings

    var id: String { rawValue }

    var label: String {
        switch self {
        case .home: return "ホーム"
        case .discover: return "ディスカバー"
        case .library: return "ライブラリ"
        case .playlists: return "プレイリスト"
        case .search: return "検索"
        case .downloads: return "ダウンロード済み"
        case .compose: return "AI作曲"
        case .settings: return "設定"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house.fill"
        case .discover: return "safari.fill"
        case .library: return "music.note.list"
        case .playlists: return "list.bullet.rectangle"
        case .search: return "magnifyingglass"
        case .downloads: return "arrow.down.circle"
        case .compose: return "sparkles"
        case .settings: return "gearshape"
        }
    }
}

/// Macネイティブのシェル（サイドバー + ウィンドウ下のプレイヤーバー）
struct MacShellView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var player: PlayerEngine

    @State private var section: MacSection? = .home
    @State private var showNowPlaying = false

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            detail
                // プレイヤーバーは詳細側だけに置き、左サイドバーと被らせない
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if player.currentTrack != nil {
                        MacPlayerBar(showNowPlaying: $showNowPlaying)
                    }
                }
        }
        .sheet(isPresented: $showNowPlaying) {
            NowPlayingView()
                .environmentObject(player)
                .frame(minWidth: 440, idealWidth: 520, minHeight: 640, idealHeight: 760)
        }
        .frame(minWidth: 960, minHeight: 620)
    }

    private var sidebar: some View {
        List(selection: $section) {
            Section("メニュー") {
                ForEach(MacSection.allCases) { item in
                    Label(item.label, systemImage: item.icon)
                        .tag(item)
                }
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 190, ideal: 220, max: 260)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                RainbowText(
                    text: "DOPA-radio",
                    font: .system(size: 15, weight: .black, design: .rounded)
                )
                if let user = auth.user {
                    Text(user.email)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Button("ログアウト") {
                    Task { await auth.signOut() }
                }
                .buttonStyle(.link)
                .font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch section ?? .home {
        case .home: HomeView()
        case .discover: DiscoverView()
        case .library: LibraryView()
        case .playlists: PlaylistsView()
        case .search: SearchView()
        case .downloads: DownloadsView()
        case .compose: AIComposeView()
        case .settings: MacSettingsView()
        }
    }
}

/// Macの設定（スタジオDSP設定をそのまま表示）
struct MacSettingsView: View {
    var body: some View {
        StudioListContent()
            .navigationTitle("設定")
    }
}

/// Macのウインドウ下部プレイヤーバー（Apple Music風）
struct MacPlayerBar: View {
    @EnvironmentObject private var player: PlayerEngine
    @Binding var showNowPlaying: Bool

    @State private var isSeeking = false
    @State private var seekValue: Double = 0

    var body: some View {
        if let track = player.currentTrack {
            HStack(spacing: 12) {
                Button {
                    showNowPlaying = true
                } label: {
                    CachedArtwork(url: track.artworkURL) {
                        ZStack {
                            DopaColor.card
                            Image(systemName: "music.note")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .frame(width: 46, height: 46)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .help("フルプレイヤーを開く")

                VStack(alignment: .leading, spacing: 1) {
                    Text(track.title)
                        .font(.callout.weight(.semibold))
                        .lineLimit(1)
                    Text(track.artist ?? "アーティスト不明")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(width: 190, alignment: .leading)

                HStack(spacing: 14) {
                    Button {
                        player.previous()
                    } label: {
                        Image(systemName: "backward.fill")
                    }
                    .buttonStyle(.plain)
                    .help("前の曲")

                    Button {
                        player.togglePlay()
                    } label: {
                        Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(DopaColor.accent)
                    }
                    .buttonStyle(.plain)
                    .help(player.isPlaying ? "一時停止 (⌘P)" : "再生 (⌘P)")

                    Button {
                        player.next()
                    } label: {
                        Image(systemName: "forward.fill")
                    }
                    .buttonStyle(.plain)
                    .help("次の曲")
                }

                Text(formatTime(isSeeking ? seekValue : player.progress))
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)

                Slider(
                    value: Binding(
                        get: { isSeeking ? seekValue : player.progress },
                        set: { seekValue = $0 }
                    ),
                    in: 0...max(player.duration, 1),
                    onEditingChanged: { editing in
                        if editing {
                            isSeeking = true
                            seekValue = player.progress
                        } else {
                            player.seek(to: seekValue)
                            isSeeking = false
                        }
                    }
                )
                .tint(DopaColor.accent)

                Text(formatTime(player.duration))
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)

                Button {
                    player.shuffleEnabled.toggle()
                } label: {
                    Image(systemName: "shuffle")
                        .foregroundStyle(player.shuffleEnabled ? DopaColor.accent : Color.secondary)
                }
                .buttonStyle(.plain)
                .help("シャッフル (⌘S)")

                Button {
                    player.cycleRepeatMode()
                } label: {
                    Image(systemName: player.repeatMode == .one ? "repeat.1" : "repeat")
                        .foregroundStyle(player.repeatMode == .off ? Color.secondary : DopaColor.accent)
                }
                .buttonStyle(.plain)
                .help("リピート (⌘R)")

                MacAirPlayButton()
                    .frame(width: 22, height: 22)

                Image(systemName: player.userVolume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .onTapGesture {
                        player.userVolume = player.userVolume == 0 ? 1 : 0
                    }

                Slider(
                    value: Binding(
                        get: { Double(player.userVolume) },
                        set: { player.userVolume = Float($0) }
                    ),
                    in: 0...1
                )
                .frame(width: 84)
                .tint(DopaColor.accent)

                Button {
                    showNowPlaying = true
                } label: {
                    Image(systemName: "chevron.up.circle")
                }
                .buttonStyle(.plain)
                .help("フルプレイヤー")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(DopaColor.border)
                    .frame(height: 0.5)
            }
        }
    }
}

/// macOS用AirPlay出力先ボタン
struct MacAirPlayButton: NSViewRepresentable {
    func makeNSView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.isRoutePickerButtonBordered = false
        return view
    }

    func updateNSView(_ nsView: AVRoutePickerView, context: Context) {}
}

/// メニューバー「再生」メニュー
struct MacPlayerCommands: Commands {
    @ObservedObject var player: PlayerEngine

    var body: some Commands {
        CommandMenu("再生") {
            Button(player.isPlaying ? "一時停止" : "再生") {
                player.togglePlay()
            }
            .keyboardShortcut("p", modifiers: .command)
            .disabled(player.currentTrack == nil)

            Button("次の曲") { player.next() }
                .keyboardShortcut(.rightArrow, modifiers: .command)
                .disabled(player.currentTrack == nil)

            Button("前の曲") { player.previous() }
                .keyboardShortcut(.leftArrow, modifiers: .command)
                .disabled(player.currentTrack == nil)

            Divider()

            Toggle("シャッフル", isOn: $player.shuffleEnabled)
                .keyboardShortcut("s", modifiers: .command)

            Button("リピート切替（現在: \(repeatLabel)）") {
                player.cycleRepeatMode()
            }
            .keyboardShortcut("r", modifiers: .command)
        }
    }

    private var repeatLabel: String {
        switch player.repeatMode {
        case .off: return "オフ"
        case .all: return "全曲"
        case .one: return "1曲"
        }
    }
}
#endif
