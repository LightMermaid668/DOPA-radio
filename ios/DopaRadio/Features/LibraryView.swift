import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var player: PlayerEngine
    @ObservedObject private var downloads = DownloadStore.shared

    @State private var tracks: [TrackDTO] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showDownloads = false
    @State private var showUpload = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && tracks.isEmpty {
                    ProgressView("読み込み中…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, tracks.isEmpty {
                    ContentUnavailableView {
                        Label("読み込めませんでした", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("再試行") { Task { await load() } }
                    }
                } else if tracks.isEmpty {
                    ContentUnavailableView(
                        "まだ曲がありません",
                        systemImage: "music.note",
                        description: Text("Webアプリから曲をアップロードしよう")
                    )
                } else {
                    list
                }
            }
            .background(DopaColor.background)
            .navigationTitle("ライブラリ")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showUpload = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("アップロード")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            showDownloads = true
                        } label: {
                            Label("ダウンロード済み", systemImage: "arrow.down.circle")
                        }
                        if let user = auth.user {
                            Section(user.email) {
                                Button("ログアウト", role: .destructive) {
                                    Task { await auth.signOut() }
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("アカウント")
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showDownloads) {
            DownloadsView()
                .environmentObject(player)
        }
        .sheet(isPresented: $showUpload, onDismiss: {
            Task { await load() }
        }) {
            UploadView()
        }
    }

    private var list: some View {
        List {
            ForEach(Array(tracks.enumerated()), id: \.element.id) { _, track in
                Button {
                    playFrom(track)
                } label: {
                    TrackRowView(
                        title: track.title,
                        artist: track.artist,
                        artworkURL: track.artworkURL,
                        durationSec: track.durationSec,
                        pinned: track.pinnedAt != nil,
                        dimmed: !track.isReady,
                        isCurrent: player.currentTrack?.id == track.id,
                        isPlaying: player.isPlaying,
                        trailing: rowTrailing(track)
                    )
                }
                .buttonStyle(.plain)
                .listRowBackground(DopaColor.background)
                .listRowSeparatorTint(DopaColor.border)
                .contextMenu {
                    Button {
                        Task { await togglePin(track) }
                    } label: {
                        Label(
                            track.pinnedAt != nil ? "ピン留めを解除" : "ピン留め",
                            systemImage: "pin"
                        )
                    }
                    if downloads.isDownloaded(track.id) {
                        Button(role: .destructive) {
                            downloads.delete(track.id)
                        } label: {
                            Label("ダウンロードを削除", systemImage: "trash")
                        }
                    } else if track.isReady {
                        Button {
                            downloads.download(track)
                        } label: {
                            Label("ダウンロード", systemImage: "arrow.down.circle")
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func rowTrailing(_ track: TrackDTO) -> AnyView? {
        if downloads.isDownloading(track.id) {
            return AnyView(
                ZStack {
                    Circle()
                        .stroke(DopaColor.border, lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: downloads.progress[track.id] ?? 0)
                        .stroke(DopaColor.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                .frame(width: 18, height: 18)
            )
        }
        if downloads.isDownloaded(track.id) {
            return AnyView(
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(DopaColor.accent)
            )
        }
        guard !track.isReady else { return nil }
        return AnyView(
            Text(track.status == "processing" ? "変換中" : "失敗")
                .font(.caption2)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(DopaColor.card, in: Capsule())
                .foregroundStyle(.secondary)
        )
    }

    private func playFrom(_ track: TrackDTO) {
        let ready = tracks.filter { $0.isReady }
        guard let startIndex = ready.firstIndex(where: { $0.id == track.id }) else { return }
        player.play(tracks: ready.map { $0.toPlayerTrack }, startAt: startIndex)
    }

    private func togglePin(_ track: TrackDTO) async {
        struct Body: Encodable { let pinned: Bool }
        _ = try? await APIClient.shared.send(
            "/api/tracks/\(track.id)", method: "PATCH", body: Body(pinned: track.pinnedAt == nil)
        )
        await load()
    }

    private func load() async {
        errorMessage = nil
        do {
            let response = try await APIClient.shared.get("/api/tracks", as: TracksResponse.self)
            tracks = response.tracks
        } catch {
            if tracks.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
        isLoading = false
    }
}
