import Combine
import Darwin
import SafariServices
import SwiftUI
import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import AppKit
typealias PlatformViewController = NSViewController
#endif

private let extensionBundleIdentifier = "com.ziahamza.parle.Extension"

private enum ParleLink {
    static let support = URL(string: "https://ziahamza.com/parle/support")!
    static let privacyPolicy = URL(string: "https://ziahamza.com/parle/privacy")!
}

private enum SharedRecentOpenings {
#if os(macOS)
    static let suiteName = "85A9MS6428.com.ziahamza.parle.shared"
#else
    static let suiteName = "group.com.ziahamza.parle.shared"
#endif
    static let key = "recent-openings-v1"
    static let clearedBeforeKey = "recent-openings-cleared-before-v1"
    static let profileClearedBeforeKey = "recent-openings-profile-cleared-before-v1"
}

private func withRecentOpeningsLock<T>(_ body: () -> T) -> T? {
    guard let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: SharedRecentOpenings.suiteName
    ) else { return nil }
    let path = container.appendingPathComponent(".recent-openings.lock").path
    let descriptor = Darwin.open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { return nil }
    defer { Darwin.close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { return nil }
    defer { flock(descriptor, LOCK_UN) }
    return body()
}

private struct RecentDiscussion: Identifiable, Equatable {
    let key: String
    let network: String
    let networkName: String
    let place: String?
    let title: String
    let score: Int
    let commentCount: Int
    let permalink: URL

    var id: String { key }
}

private struct RecentOpening: Identifiable, Equatable {
    let profileID: String
    let subject: URL
    let title: String
    let openedAt: Date
    let archiveURL: URL?
    let discussions: [RecentDiscussion]

    var id: String { "\(profileID)\u{0}\(subject.absoluteString)" }

    var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? domain : trimmed
    }

    var domain: String {
        let host = subject.host ?? subject.absoluteString
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    var networkSummary: String {
        var seen = Set<String>()
        let names = discussions.compactMap { discussion -> String? in
            guard seen.insert(discussion.networkName).inserted else { return nil }
            return discussion.networkName
        }
        return names.joined(separator: ", ")
    }
}

@MainActor
private final class RecentOpeningsModel: ObservableObject {
    @Published private(set) var openings: [RecentOpening] = []
    @Published private(set) var clearFailure: String?
#if os(macOS)
    @Published private(set) var extensionEnabled: Bool?
#endif

    private let defaults = UserDefaults(suiteName: SharedRecentOpenings.suiteName)

    init() {
        reload()
        checkExtension()
    }

    func reload() {
        guard let defaults else { return }
        guard let retained = withRecentOpeningsLock({
            defaults.synchronize()
            let raw = defaults.array(forKey: SharedRecentOpenings.key) as? [[String: Any]] ?? []
            let cutoff = Date().addingTimeInterval(-30 * 24 * 60 * 60)
            let retained = raw.compactMap { row -> (raw: [String: Any], opening: RecentOpening)? in
                guard let opening = Self.opening(from: row),
                      opening.openedAt >= cutoff,
                      opening.openedAt.timeIntervalSince1970 * 1_000 > clearedBefore(opening.profileID)
                else {
                    return nil
                }
                return (row, opening)
            }
            if retained.count != raw.count {
                defaults.set(retained.map(\.raw), forKey: SharedRecentOpenings.key)
                defaults.synchronize()
            }
            return retained
        }) else { return }
        let decoded = retained.map(\.opening).sorted { $0.openedAt > $1.openedAt }
        if decoded != openings { openings = decoded }
    }

    func clear() {
        guard let defaults else {
            clearFailure = "The shared Safari store is unavailable. Your Recents were not confirmed cleared."
            return
        }
        let cleared = withRecentOpeningsLock {
            guard defaults.synchronize() else { return false }
            let requestedAt = Date().timeIntervalSince1970 * 1_000
            let held = defaults.double(forKey: SharedRecentOpenings.clearedBeforeKey)
            defaults.set(max(held, requestedAt), forKey: SharedRecentOpenings.clearedBeforeKey)
            defaults.removeObject(forKey: SharedRecentOpenings.profileClearedBeforeKey)
            defaults.removeObject(forKey: SharedRecentOpenings.key)
            return defaults.synchronize()
        } ?? false
        guard cleared else {
            clearFailure = "Parle could not confirm the shared store was cleared. Please try again."
            return
        }
        clearFailure = nil
        reload()
    }

    func dismissClearFailure() {
        clearFailure = nil
    }

    private func clearedBefore(_ profileID: String) -> Double {
        let allProfiles = defaults?.double(forKey: SharedRecentOpenings.clearedBeforeKey) ?? 0
        let byProfile = defaults?.dictionary(
            forKey: SharedRecentOpenings.profileClearedBeforeKey
        )?[profileID] as? NSNumber
        return max(allProfiles, byProfile?.doubleValue ?? 0)
    }

    func checkExtension() {
#if os(macOS)
        SFSafariExtensionManager.getStateOfSafariExtension(
            withIdentifier: extensionBundleIdentifier
        ) { [weak self] state, _ in
            DispatchQueue.main.async { self?.extensionEnabled = state?.isEnabled }
        }
#endif
    }

    func openExtensionSettings() {
#if os(macOS)
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: extensionBundleIdentifier,
            completionHandler: { _ in }
        )
#else
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
#endif
    }

    private static func opening(from raw: [String: Any]) -> RecentOpening? {
        guard
            let profileID = raw["profileID"] as? String,
            let subjectText = raw["subject"] as? String,
            let subject = webURL(subjectText),
            let openedAt = number(raw["openedAt"])?.doubleValue
        else { return nil }

        let title = (raw["title"] as? String) ?? ""
        let archiveURL = (raw["archiveUrl"] as? String).flatMap(webURL)
        let discussionRows = raw["discussions"] as? [[String: Any]] ?? []
        let discussions = discussionRows.compactMap(discussion(from:))

        return RecentOpening(
            profileID: profileID,
            subject: subject,
            title: title,
            openedAt: Date(timeIntervalSince1970: openedAt / 1_000),
            archiveURL: archiveURL,
            discussions: discussions
        )
    }

    private static func discussion(from raw: [String: Any]) -> RecentDiscussion? {
        guard
            let key = raw["key"] as? String,
            let network = raw["network"] as? String,
            let networkName = raw["networkName"] as? String,
            let title = raw["title"] as? String,
            let permalinkText = raw["permalink"] as? String,
            let permalink = webURL(permalinkText)
        else { return nil }

        return RecentDiscussion(
            key: key,
            network: network,
            networkName: networkName,
            place: raw["place"] as? String,
            title: title,
            score: number(raw["score"])?.intValue ?? 0,
            commentCount: number(raw["commentCount"])?.intValue ?? 0,
            permalink: permalink
        )
    }

    private static func webURL(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme == "https" || url.scheme == "http" else {
            return nil
        }
        return url
    }

    private static func number(_ value: Any?) -> NSNumber? {
        value as? NSNumber
    }
}

private struct RecentOpeningRow: View {
    let opening: RecentOpening

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(opening.displayTitle)
                .font(.headline)
                .lineLimit(2)
            HStack(spacing: 8) {
                Text(opening.domain)
                Text(opening.openedAt, style: .relative)
            }
            .font(.caption)
            .foregroundColor(.secondary)
            if !opening.discussions.isEmpty {
                Text("\(opening.discussions.count) discussion\(opening.discussions.count == 1 ? "" : "s") · \(opening.networkSummary)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct DiscussionRow: View {
    let discussion: RecentDiscussion

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(discussion.title.isEmpty ? discussion.networkName : discussion.title)
                .foregroundColor(.primary)
                .lineLimit(3)
            HStack(spacing: 10) {
                Label(
                    discussion.place.map { "\(discussion.networkName) · \($0)" }
                        ?? discussion.networkName,
                    systemImage: "bubble.left.and.bubble.right"
                )
                if discussion.score > 0 {
                    Label("\(discussion.score)", systemImage: "arrow.up")
                }
                Label("\(discussion.commentCount)", systemImage: "text.bubble")
            }
            .font(.caption)
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct RecentOpeningDetail: View {
    let opening: RecentOpening

    var body: some View {
        List {
            Section {
                Link(destination: opening.subject) {
                    Label("Open original page", systemImage: "safari")
                }
                if let archiveURL = opening.archiveURL {
                    Link(destination: archiveURL) {
                        Label("Open archived copy", systemImage: "clock.arrow.circlepath")
                    }
                }
            } header: {
                Text(opening.domain)
            }

            Section {
                if opening.discussions.isEmpty {
                    Text("No discussions had arrived when this page was last opened in Parle.")
                        .foregroundColor(.secondary)
                } else {
                    ForEach(opening.discussions) { discussion in
                        Link(destination: discussion.permalink) {
                            DiscussionRow(discussion: discussion)
                        }
                    }
                }
            } header: {
                Text("All Parle discussions")
            }
        }
        .navigationTitle(opening.displayTitle)
    }
}

private struct ExtensionHelp: View {
    @ObservedObject var model: RecentOpeningsModel

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
#if os(macOS)
                Label(
                    model.extensionEnabled == true ? "Safari extension enabled" : "Enable Parle in Safari",
                    systemImage: model.extensionEnabled == true ? "checkmark.circle.fill" : "safari"
                )
                Text("Open Safari Settings, choose Extensions, then turn on Parle.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Button("Open Safari Extension Settings") { model.openExtensionSettings() }
#else
                Label("Enable Parle in Safari", systemImage: "safari")
                Text("In Settings, choose Safari, Extensions, Parle, then turn it on and allow the sites where you read.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Button("Open Settings") { model.openExtensionSettings() }
#endif
            }
            .padding(.vertical, 4)
        } header: {
            Text("Safari extension")
        }
    }
}

private struct HelpAndPrivacy: View {
    var body: some View {
        Section {
            Link(destination: ParleLink.support) {
                Label("Support", systemImage: "questionmark.circle")
            }
            Link(destination: ParleLink.privacyPolicy) {
                Label("Privacy Policy", systemImage: "hand.raised")
            }
        } header: {
            Text("Help and privacy")
        }
    }
}

private struct RecentOpeningsView: View {
    @StateObject private var model = RecentOpeningsModel()
    @State private var confirmingClear = false
    @Environment(\.scenePhase) private var scenePhase
    private let refresh = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationView {
            List {
                Section {
                    if model.openings.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "clock.arrow.circlepath")
                                .font(.system(size: 34))
                                .foregroundColor(.secondary)
                            Text("No recent discussions yet")
                                .font(.headline)
                            Text("Open Parle beside a page in Safari. This app will keep that page and all the discussions Parle found, only on this device, for 30 days.")
                                .multilineTextAlignment(.center)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                    } else {
                        ForEach(model.openings) { opening in
                            NavigationLink(destination: RecentOpeningDetail(opening: opening)) {
                                RecentOpeningRow(opening: opening)
                            }
                        }
                    }
                } header: {
                    Text("Recent on this device")
                } footer: {
                    Text("Parle keeps at most 100 pages for 30 days. It does not sync this list or send it to us.")
                }

                ExtensionHelp(model: model)
                HelpAndPrivacy()
            }
            .navigationTitle("Parle")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(role: .destructive) { confirmingClear = true } label: {
                        Label("Clear Recents", systemImage: "trash")
                    }
                    .disabled(model.openings.isEmpty)
                }
            }
            .alert("Clear Recent Discussions?", isPresented: $confirmingClear) {
                Button("Cancel", role: .cancel) {}
                Button("Clear", role: .destructive) { model.clear() }
            } message: {
                Text("This removes every recent page and discussion saved by Parle on this device.")
            }
            .alert(
                "Couldn’t Clear Recents",
                isPresented: Binding(
                    get: { model.clearFailure != nil },
                    set: { visible in
                        if !visible { model.dismissClearFailure() }
                    }
                )
            ) {
                Button("OK") { model.dismissClearFailure() }
            } message: {
                Text(model.clearFailure ?? "Please try again.")
            }
        }
        .parleNavigationStyle()
        .onAppear {
            model.reload()
            model.checkExtension()
        }
        .onReceive(refresh) { _ in model.reload() }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                model.reload()
                model.checkExtension()
            }
        }
    }
}

private extension View {
    @ViewBuilder
    func parleNavigationStyle() -> some View {
#if os(iOS)
        navigationViewStyle(StackNavigationViewStyle())
#else
        self
#endif
    }
}

class ViewController: PlatformViewController {
    @IBOutlet var webView: WKWebView!

#if os(iOS)
    private var host: UIHostingController<RecentOpeningsView>?
#else
    private var host: NSHostingController<RecentOpeningsView>?
#endif

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.removeFromSuperview()

        let host = HostingController(rootView: RecentOpeningsView())
        self.host = host
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
#if os(iOS)
        host.didMove(toParent: self)
#endif
    }

#if os(macOS)
    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.minSize = NSSize(width: 560, height: 500)
        view.window?.setContentSize(NSSize(width: 760, height: 640))
    }
#endif
}

#if os(iOS)
private typealias HostingController<Content: View> = UIHostingController<Content>
#else
private typealias HostingController<Content: View> = NSHostingController<Content>
#endif
