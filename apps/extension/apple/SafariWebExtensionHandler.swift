import CoreFoundation
import Darwin
import Foundation
import SafariServices

private enum RecentOpeningsStore {
#if os(macOS)
    static let suiteName = "85A9MS6428.com.ziahamza.parle.shared"
#else
    static let suiteName = "group.com.ziahamza.parle.shared"
#endif

    static let key = "recent-openings-v1"
    static let clearedBeforeKey = "recent-openings-cleared-before-v1"
    static let profileClearedBeforeKey = "recent-openings-profile-cleared-before-v1"
    static let schemaVersion = 1
    static let maximumOpenings = 100
    static let retentionMilliseconds = 30.0 * 24.0 * 60.0 * 60.0 * 1_000.0
    static let futureClockToleranceMilliseconds = 5.0 * 60.0 * 1_000.0

    static let maximumTitleLength = 300
    static let maximumDiscussionKeyLength = 512
    static let maximumNetworkNameLength = 64
    static let maximumPlaceLength = 128
    static let maximumURLLength = 4_096

    static let networks = Set([
        "hackernews",
        "reddit",
        "x",
        "bluesky",
        "lemmy",
        "lobsters"
    ])
    static let tiers = Set(["linked", "passing"])

}

/// An order-independent choice for display text. Empty and shorter values
/// carry less information; equal-length alternatives use lexical order so the
/// result is stable no matter which native request acquires the lock last.
private func preferredText(_ left: String, _ right: String) -> String {
    if left.isEmpty != right.isEmpty { return left.isEmpty ? right : left }
    let leftLength = left.unicodeScalars.count
    let rightLength = right.unicodeScalars.count
    if leftLength != rightLength { return leftLength > rightLength ? left : right }
    return left >= right ? left : right
}

private func preferredText(_ left: String?, _ right: String?) -> String? {
    switch (left, right) {
    case let (.some(left), .some(right)):
        return preferredText(left, right)
    case let (.some(left), .none):
        return left
    case let (.none, .some(right)):
        return right
    case (.none, .none):
        return nil
    }
}

private struct StoredDiscussion {
    let key: String
    let network: String
    let networkName: String
    let place: String?
    let title: String
    let score: Int
    let commentCount: Int
    let permalink: String
    let tier: String

    init?(dictionary: [String: Any], requiresPlace: Bool = true) {
        guard
            let key = boundedString(
                dictionary["key"],
                maximum: RecentOpeningsStore.maximumDiscussionKeyLength,
                allowEmpty: false
            ),
            let network = boundedString(dictionary["network"], maximum: 32, allowEmpty: false),
            RecentOpeningsStore.networks.contains(network),
            let networkName = boundedString(
                dictionary["networkName"],
                maximum: RecentOpeningsStore.maximumNetworkNameLength,
                allowEmpty: false
            ),
            let title = boundedString(
                dictionary["title"],
                maximum: RecentOpeningsStore.maximumTitleLength
            ),
            let score = integer(dictionary["score"]),
            let commentCount = integer(dictionary["commentCount"]),
            commentCount >= 0,
            let permalink = webURLString(dictionary["permalink"]),
            let tier = boundedString(dictionary["tier"], maximum: 16, allowEmpty: false),
            RecentOpeningsStore.tiers.contains(tier)
        else { return nil }

        let place: String?
        switch dictionary["place"] {
        case is NSNull:
            place = nil
        case nil:
            if requiresPlace { return nil }
            place = nil
        case let value:
            guard let decoded = boundedString(
                value,
                maximum: RecentOpeningsStore.maximumPlaceLength
            ) else { return nil }
            place = decoded
        }

        self.key = key
        self.network = network
        self.networkName = networkName
        self.place = place
        self.title = title
        self.score = score
        self.commentCount = commentCount
        self.permalink = permalink
        self.tier = tier
    }

    private init(
        key: String,
        network: String,
        networkName: String,
        place: String?,
        title: String,
        score: Int,
        commentCount: Int,
        permalink: String,
        tier: String
    ) {
        self.key = key
        self.network = network
        self.networkName = networkName
        self.place = place
        self.title = title
        self.score = score
        self.commentCount = commentCount
        self.permalink = permalink
        self.tier = tier
    }

    /// A commutative, idempotent join for duplicate frames of one Discussion.
    /// Counts only rise, Linked outranks Passing, and text uses a deterministic
    /// richness order. A delayed old native request therefore cannot regress a
    /// row that a fresher request already persisted.
    func merging(existing: StoredDiscussion) -> StoredDiscussion {
        StoredDiscussion(
            key: key,
            network: preferredText(network, existing.network),
            networkName: preferredText(networkName, existing.networkName),
            place: preferredText(place, existing.place),
            title: preferredText(title, existing.title),
            score: max(score, existing.score),
            commentCount: max(commentCount, existing.commentCount),
            permalink: preferredText(permalink, existing.permalink),
            tier: tier == "linked" || existing.tier == "linked" ? "linked" : "passing"
        )
    }

    var propertyList: [String: Any] {
        var dictionary: [String: Any] = [
            "key": key,
            "network": network,
            "networkName": networkName,
            "title": title,
            "score": score,
            "commentCount": commentCount,
            "permalink": permalink,
            "tier": tier
        ]
        // `NSNull` is valid JSON but not a property-list value. Omitting the
        // optional field keeps every value safe for UserDefaults.
        if let place = place { dictionary["place"] = place }
        return dictionary
    }
}

private struct StoredOpening {
    let profileID: String
    let subject: String
    let title: String
    let openedAt: Double
    let archiveURL: String?
    let discussions: [StoredDiscussion]

    var identity: String { "\(profileID)\u{0}\(subject)" }

    init?(
        command: [String: Any],
        profileID: String,
        now: Double,
        requiresPlace: Bool = false
    ) {
        guard
            schemaVersion(command["schemaVersion"]) == RecentOpeningsStore.schemaVersion,
            command["command"] as? String == "recordOpening",
            let clippedSubject = clippedString(
                command["subject"],
                maximum: RecentOpeningsStore.maximumURLLength,
                allowEmpty: false
            ),
            let subject = webURLString(clippedSubject),
            let title = boundedString(
                command["title"],
                maximum: RecentOpeningsStore.maximumTitleLength
            ),
            let openedAt = finiteNumber(command["openedAt"]),
            openedAt > 0,
            openedAt <= now + RecentOpeningsStore.futureClockToleranceMilliseconds,
            let rawDiscussions = command["discussions"] as? [Any]
        else { return nil }

        var discussions: [StoredDiscussion] = []
        var seen = Set<String>()
        for raw in rawDiscussions {
            // One bad permalink, score, or place must not drop the page, Archive
            // link, and the rows that did decode.
            guard
                let dictionary = raw as? [String: Any],
                let discussion = StoredDiscussion(
                    dictionary: dictionary,
                    requiresPlace: requiresPlace
                )
            else { continue }
            if seen.insert(discussion.key).inserted { discussions.append(discussion) }
        }

        let archiveURL: String?
        if let rawArchiveURL = command["archiveUrl"] {
            guard let decoded = webURLString(rawArchiveURL) else { return nil }
            archiveURL = decoded
        } else {
            archiveURL = nil
        }

        self.profileID = profileID
        self.subject = subject
        self.title = title
        self.openedAt = openedAt
        self.archiveURL = archiveURL
        self.discussions = discussions
    }

    init?(stored dictionary: [String: Any], now: Double) {
        guard
            let profileID = boundedString(dictionary["profileID"], maximum: 128, allowEmpty: false),
            let opening = StoredOpening(
                command: dictionary,
                profileID: profileID,
                now: now,
                requiresPlace: false
            )
        else { return nil }
        self = opening
    }

    private init(
        profileID: String,
        subject: String,
        title: String,
        openedAt: Double,
        archiveURL: String?,
        discussions: [StoredDiscussion]
    ) {
        self.profileID = profileID
        self.subject = subject
        self.title = title
        self.openedAt = openedAt
        self.archiveURL = archiveURL
        self.discussions = discussions
    }

    /// Equal `openedAt` means another frame from the same explicit panel open.
    /// Keep that record monotonic across service-worker restarts: a reminted
    /// empty Board must not erase Archive or Discussion results already saved.
    /// This is an order-independent join because a timed-out Safari request can
    /// finish after another worker has delivered a fresher frame.
    func merging(existing: StoredOpening) -> StoredOpening {
        var byKey: [String: StoredDiscussion] = [:]
        for discussion in existing.discussions + discussions {
            if let held = byKey[discussion.key] {
                byKey[discussion.key] = discussion.merging(existing: held)
            } else {
                byKey[discussion.key] = discussion
            }
        }
        let mergedDiscussions = byKey.values.sorted {
            if $0.tier != $1.tier { return $0.tier == "linked" }
            if $0.commentCount != $1.commentCount { return $0.commentCount > $1.commentCount }
            if $0.score != $1.score { return $0.score > $1.score }
            return $0.key < $1.key
        }
        return StoredOpening(
            profileID: profileID,
            subject: subject,
            title: preferredText(title, existing.title),
            openedAt: openedAt,
            archiveURL: preferredText(archiveURL, existing.archiveURL),
            discussions: mergedDiscussions
        )
    }

    var propertyList: [String: Any] {
        var dictionary: [String: Any] = [
            "schemaVersion": RecentOpeningsStore.schemaVersion,
            "command": "recordOpening",
            "profileID": profileID,
            "subject": subject,
            "title": title,
            "openedAt": openedAt,
            "discussions": discussions.map(\.propertyList)
        ]
        if let archiveURL = archiveURL { dictionary["archiveUrl"] = archiveURL }
        return dictionary
    }
}

private func boundedString(
    _ raw: Any?,
    maximum: Int,
    allowEmpty: Bool = true
) -> String? {
    guard let value = raw as? String, value.unicodeScalars.count <= maximum else { return nil }
    if !allowEmpty && value.isEmpty { return nil }
    return value
}

/// Clip to `maximum` Unicode scalars so a slightly over-long subject still
/// records the page. Rejects rather than clipping empty strings when
/// `allowEmpty` is false.
private func clippedString(
    _ raw: Any?,
    maximum: Int,
    allowEmpty: Bool = true
) -> String? {
    guard let value = raw as? String else { return nil }
    let clipped: String
    if value.unicodeScalars.count <= maximum {
        clipped = value
    } else {
        clipped = String(String.UnicodeScalarView(value.unicodeScalars.prefix(maximum)))
    }
    if !allowEmpty && clipped.isEmpty { return nil }
    return clipped
}

private func finiteNumber(_ raw: Any?) -> Double? {
    guard let value = raw as? NSNumber else { return nil }
    // Swift bridges booleans through NSNumber; they are not timestamps or counts.
    guard CFGetTypeID(value) != CFBooleanGetTypeID() else { return nil }
    let decoded = value.doubleValue
    return decoded.isFinite ? decoded : nil
}

private func integer(_ raw: Any?) -> Int? {
    guard let decoded = finiteNumber(raw), decoded.rounded(.towardZero) == decoded else {
        return nil
    }
    guard decoded >= Double(Int.min), decoded <= Double(Int.max) else { return nil }
    return Int(decoded)
}

private func schemaVersion(_ raw: Any?) -> Int? {
    integer(raw)
}

private func webURLString(_ raw: Any?) -> String? {
    guard
        let value = boundedString(
            raw,
            maximum: RecentOpeningsStore.maximumURLLength,
            allowEmpty: false
        ),
        let components = URLComponents(string: value),
        let scheme = components.scheme?.lowercased(),
        scheme == "http" || scheme == "https",
        components.host?.isEmpty == false
    else { return nil }
    return value
}

/// UserDefaults offers no cross-process read/modify/write transaction. Both
/// the containing app and extension take this App Group file lock around every
/// Recent-list transaction so a reader-side prune cannot overwrite a fresh
/// extension write from another Safari profile.
private func withRecentOpeningsLock<T>(_ body: () -> T) -> T? {
    guard let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: RecentOpeningsStore.suiteName
    ) else { return nil }
    let path = container.appendingPathComponent(".recent-openings.lock").path
    let descriptor = Darwin.open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { return nil }
    defer { Darwin.close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { return nil }
    defer { flock(descriptor, LOCK_UN) }
    return body()
}

private func profileIdentifier(from item: NSExtensionItem?) -> String {
    let raw: Any?
    if #available(iOS 17.0, macOS 14.0, *) {
        raw = item?.userInfo?[SFExtensionProfileKey]
    } else {
        raw = item?.userInfo?["profile"]
    }
    if let profile = raw as? UUID { return profile.uuidString.lowercased() }
    if let profile = boundedString(raw, maximum: 128, allowEmpty: false) { return profile }
    return "default"
}

private func clearedBefore(_ defaults: UserDefaults, profileID: String) -> Double {
    let allProfiles = finiteNumber(defaults.object(
        forKey: RecentOpeningsStore.clearedBeforeKey
    )) ?? 0
    let byProfile = defaults.dictionary(
        forKey: RecentOpeningsStore.profileClearedBeforeKey
    )?[profileID]
    return max(allProfiles, finiteNumber(byProfile) ?? 0)
}

private func requestMessage(from item: NSExtensionItem?) -> [String: Any]? {
    let raw: Any?
    if #available(iOS 15.0, macOS 11.0, *) {
        raw = item?.userInfo?[SFExtensionMessageKey]
    } else {
        raw = item?.userInfo?["message"]
    }
    return raw as? [String: Any]
}

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        guard let command = requestMessage(from: item) else {
            complete(context, response: ["ok": false, "error": "invalid message"])
            return
        }
        guard schemaVersion(command["schemaVersion"]) == RecentOpeningsStore.schemaVersion else {
            complete(context, response: ["ok": false, "error": "unsupported schema"])
            return
        }

        switch command["command"] as? String {
        case "recordOpening":
            record(command, profileID: profileIdentifier(from: item), context: context)
        case "clearRecentOpenings":
            clear(command, context: context)
        default:
            complete(context, response: ["ok": false, "error": "unsupported command"])
        }
    }

    private func record(
        _ command: [String: Any],
        profileID: String,
        context: NSExtensionContext
    ) {
        let now = Date().timeIntervalSince1970 * 1_000.0
        guard let opening = StoredOpening(command: command, profileID: profileID, now: now) else {
            complete(context, response: ["ok": false, "error": "invalid opening"])
            return
        }
        guard let defaults = UserDefaults(suiteName: RecentOpeningsStore.suiteName) else {
            complete(context, response: ["ok": false, "error": "shared store unavailable"])
            return
        }

        let persisted = withRecentOpeningsLock {
            defaults.synchronize()
            // A companion-side clear cannot reach a live Safari service worker.
            // The durable watermark makes that clear win over every frame from
            // a panel whose explicit open happened before it.
            if opening.openedAt <= clearedBefore(defaults, profileID: profileID) {
                return true
            }
            let stored = defaults.array(forKey: RecentOpeningsStore.key) as? [[String: Any]] ?? []
            let cutoff = now - RecentOpeningsStore.retentionMilliseconds
            var byIdentity: [String: StoredOpening] = [:]

            for dictionary in stored {
                guard let candidate = StoredOpening(stored: dictionary, now: now) else { continue }
                guard candidate.openedAt >= cutoff else { continue }
                guard candidate.openedAt > clearedBefore(defaults, profileID: candidate.profileID) else {
                    continue
                }
                if let held = byIdentity[candidate.identity] {
                    if candidate.openedAt > held.openedAt {
                        byIdentity[candidate.identity] = candidate
                    } else if candidate.openedAt == held.openedAt {
                        byIdentity[candidate.identity] = candidate.merging(existing: held)
                    }
                } else {
                    byIdentity[candidate.identity] = candidate
                }
            }
            if opening.openedAt >= cutoff {
                if let held = byIdentity[opening.identity] {
                    if opening.openedAt > held.openedAt {
                        byIdentity[opening.identity] = opening
                    } else if opening.openedAt == held.openedAt {
                        byIdentity[opening.identity] = opening.merging(existing: held)
                    }
                } else {
                    byIdentity[opening.identity] = opening
                }
            }

            let retained = byIdentity.values.sorted {
                if $0.openedAt != $1.openedAt { return $0.openedAt > $1.openedAt }
                return $0.identity < $1.identity
            }.prefix(RecentOpeningsStore.maximumOpenings)
            defaults.set(retained.map(\.propertyList), forKey: RecentOpeningsStore.key)
            return defaults.synchronize()
        } ?? false
        complete(
            context,
            response: persisted
                ? ["ok": true]
                : ["ok": false, "error": "shared store unavailable"]
        )
    }

    private func clear(_ command: [String: Any], context: NSExtensionContext) {
        guard let defaults = UserDefaults(suiteName: RecentOpeningsStore.suiteName) else {
            complete(context, response: ["ok": false, "error": "shared store unavailable"])
            return
        }
        let now = Date().timeIntervalSince1970 * 1_000.0
        guard
            let requestedAt = finiteNumber(command["clearedAt"]),
            requestedAt > 0,
            requestedAt <= now + RecentOpeningsStore.futureClockToleranceMilliseconds
        else {
            complete(context, response: ["ok": false, "error": "invalid clear boundary"])
            return
        }
        let cutoff = now - RecentOpeningsStore.retentionMilliseconds
        let persisted = withRecentOpeningsLock {
            defaults.synchronize()
            let existingBoundary = finiteNumber(defaults.object(
                forKey: RecentOpeningsStore.clearedBeforeKey
            )) ?? 0
            let boundary = max(existingBoundary, requestedAt)
            defaults.set(boundary, forKey: RecentOpeningsStore.clearedBeforeKey)
            defaults.removeObject(forKey: RecentOpeningsStore.profileClearedBeforeKey)
            let stored = defaults.array(forKey: RecentOpeningsStore.key) as? [[String: Any]] ?? []
            let retained = stored.compactMap { dictionary -> StoredOpening? in
                guard let opening = StoredOpening(stored: dictionary, now: now) else { return nil }
                return opening.openedAt > boundary && opening.openedAt >= cutoff ? opening : nil
            }.sorted {
                if $0.openedAt != $1.openedAt { return $0.openedAt > $1.openedAt }
                return $0.identity < $1.identity
            }.prefix(RecentOpeningsStore.maximumOpenings)
            if retained.isEmpty {
                defaults.removeObject(forKey: RecentOpeningsStore.key)
            } else {
                defaults.set(retained.map(\.propertyList), forKey: RecentOpeningsStore.key)
            }
            return defaults.synchronize()
        } ?? false
        complete(
            context,
            response: persisted
                ? ["ok": true]
                : ["ok": false, "error": "shared store unavailable"]
        )
    }

    private func complete(_ context: NSExtensionContext, response: [String: Any]) {
        let item = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            item.userInfo = [SFExtensionMessageKey: response]
        } else {
            item.userInfo = ["message": response]
        }
        context.completeRequest(returningItems: [item], completionHandler: nil)
    }
}
