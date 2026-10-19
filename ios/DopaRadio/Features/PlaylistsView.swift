import SwiftUI

/// プレイリスト一覧（自分のプレイリスト）
struct PlaylistsView: View {
    @State private var playlists: [PlaylistSummaryDTO] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showCreate = false

    private static let visibilityLabels: [String: String] = [
        "private": "非公開",
        "unlisted": "限定公開",
        "public": "公開",
    ]

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && playlists.isEmpty {
                    ProgressView("読み込み中…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, playlists.isEmpty {
                    ContentUnavailableView {
                        Label("読み込めませんでした", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("再試行") { Task { await load() } }
                    }
                } else if playlists.isEmpty {
                    ContentUnavailableView(
                        "プレイリストがありません",
                        systemImage: "list.bullet.rectangle",
                        description: Text("右上の＋から作成して仲間に共有しよう")
                    )
                } else {
                    list
                }
            }
            .background(DopaColor.background)
            .navigationTitle("プレイリスト")
            .toolbar {
                ToolbarItem(placement: .dopaTrailing) {
                    Button {
                        showCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("新規作成")
                }
            }
            .sheet(isPresented: $showCreate) {
                CreatePlaylistSheet { created in
                    if created { Task { await load() } }
                }
                .presentationDetents([.height(220)])
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private var list: some View {
        List {
            ForEach(playlists) { playlist in
                NavigationLink {
                    PlaylistDetailView(source: .own(id: playlist.id))
                } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            DopaColor.card
                            Image(systemName: "list.bullet.rectangle")
                                .foregroundStyle(DopaColor.accent)
                        }
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(playlist.title)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            Text(
                                "\(Self.visibilityLabels[playlist.visibility ?? ""] ?? "非公開") ・ \(playlist.itemCount ?? 0)曲"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
                .listRowBackground(DopaColor.background)
                .listRowSeparatorTint(DopaColor.border)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func load() async {
        errorMessage = nil
        do {
            let response = try await APIClient.shared.get(
                "/api/playlists", as: PlaylistsResponse.self
            )
            playlists = response.playlists
        } catch {
            if playlists.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
        isLoading = false
    }
}

private struct CreatePlaylistSheet: View {
    let onDone: (Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var isBusy = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TextField("プレイリスト名（例: ドパ朝プレイリスト）", text: $title)
                    .padding(14)
                    .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(DopaColor.border))

                Button {
                    Task { await create() }
                } label: {
                    HStack {
                        if isBusy { ProgressView().tint(.black) }
                        Text(isBusy ? "作成中…" : "作成")
                            .font(.headline)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .background(DopaColor.accent, in: Capsule())
                .foregroundStyle(.black)
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isBusy)

                Spacer()
            }
            .padding(20)
            .background(DopaColor.background)
            .navigationTitle("新しいプレイリスト")
            .dopaInlineTitle()
            .toolbar {
                ToolbarItem(placement: .dopaLeading) {
                    Button("キャンセル") { dismiss() }
                }
            }
        }
    }

    private func create() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            struct Body: Encodable { let title: String }
            _ = try await APIClient.shared.send(
                "/api/playlists",
                method: "POST",
                body: Body(title: title.trimmingCharacters(in: .whitespacesAndNewlines))
            )
            onDone(true)
        } catch {
            onDone(false)
        }
        dismiss()
    }
}
