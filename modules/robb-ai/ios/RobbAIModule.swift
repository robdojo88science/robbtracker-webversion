import ExpoModulesCore
import Foundation
import CommonCrypto
#if canImport(FoundationModels)
import FoundationModels
#endif

public final class RobbAIModule: Module {
  private let worker = RobbAIWorker()

  public func definition() -> ModuleDefinition {
    Name("RobbAI")

    // AsyncFunction runs on Expo's background queue, keeping PIN work off the JS/UI threads.
    // This is the same PBKDF2-SHA256 format as the existing JS implementation.
    AsyncFunction("deriveActionPin") { (value: String, saltHex: String, iterations: Int) throws -> String in
      guard iterations == 210_000, value.utf8.count <= 1024, saltHex.utf8.count == 64,
            saltHex.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
        throw NSError(domain: "RobbSecurity", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid secure PIN parameters."])
      }
      let salt = stride(from: 0, to: 64, by: 2).map { offset in
        UInt8(saltHex.dropFirst(offset).prefix(2), radix: 16)!
      }
      let keyLength = 32
      var derived = [UInt8](repeating: 0, count: keyLength)
      let status = value.withCString { password in
        salt.withUnsafeBufferPointer { saltBytes in
          derived.withUnsafeMutableBufferPointer { keyBytes in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password, value.lengthOfBytes(using: .utf8), saltBytes.baseAddress, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), keyBytes.baseAddress, keyLength)
          }
        }
      }
      guard status == kCCSuccess else {
        throw NSError(domain: "RobbSecurity", code: 2, userInfo: [NSLocalizedDescriptionKey: "Secure PIN verification could not complete."])
      }
      return derived.map { String(format: "%02x", $0) }.joined()
    }

    AsyncFunction("availability") { () -> [String: Any] in
      RobbAIWorker.availability()
    }
    AsyncFunction("generate") { (prompt: String, instructions: String) async throws -> String in
      try await self.worker.generate(prompt: prompt, instructions: instructions)
    }
    AsyncFunction("cancel") { () async -> Void in
      await self.worker.cancel()
    }
    OnDestroy {
      Task { await self.worker.cancel() }
    }
  }
}

private actor RobbAIWorker {
  private var active: Task<String, Error>?

  nonisolated static func availability() -> [String: Any] {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
      case .available:
        return ["available": true, "code": "available", "message": "Apple on-device AI is ready. No internet is needed."]
      case .unavailable(.deviceNotEligible):
        return unavailable("deviceNotEligible", "This device does not support Apple Intelligence. Basic offline entry still works.")
      case .unavailable(.appleIntelligenceNotEnabled):
        return unavailable("appleIntelligenceNotEnabled", "Turn on Apple Intelligence in iPhone or iPad Settings to use on-device AI.")
      case .unavailable(.modelNotReady):
        return unavailable("modelNotReady", "Apple's model is not ready. Let its download finish in device Settings, then try again.")
      case .unavailable:
        return unavailable("unavailable", "Apple on-device AI is unavailable on this device right now.")
      @unknown default:
        return unavailable("unavailable", "Apple on-device AI reported an unsupported availability state.")
      }
    }
    return unavailable("unsupportedOS", "On-device AI needs iOS or iPadOS 26 or later. Basic offline entry still works.")
    #else
    return unavailable("unsupportedBuild", "This build was made without Apple's Foundation Models SDK. Install a new build made with Xcode 26 or later.")
    #endif
  }

  nonisolated private static func unavailable(_ code: String, _ message: String) -> [String: Any] {
    ["available": false, "code": code, "message": message]
  }

  func cancel() { active?.cancel() }

  func generate(prompt: String, instructions: String) async throws -> String {
    guard active == nil else { throw NSError(domain: "RobbAI", code: 2, userInfo: [NSLocalizedDescriptionKey: "An on-device request is still finishing. Try again shortly."]) }
    guard prompt.count <= 10000, instructions.count <= 6000 else { throw NSError(domain: "RobbAI", code: 3, userInfo: [NSLocalizedDescriptionKey: "Keep the AI request short."]) }
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      guard SystemLanguageModel.default.isAvailable else { throw NSError(domain: "RobbAI", code: 1, userInfo: [NSLocalizedDescriptionKey: Self.availability()["message"] as? String ?? "Apple on-device AI is unavailable."]) }
      let task = Task<String, Error> {
        let session = LanguageModelSession(model: SystemLanguageModel.default, instructions: instructions)
        let response = try await session.respond(to: prompt, generating: RobbIntent.self, options: GenerationOptions(sampling: .greedy, maximumResponseTokens: 1000))
        try Task.checkCancellation()
        return String(decoding: try JSONEncoder().encode(response.content), as: UTF8.self)
      }
      active = task
      defer { active = nil }
      return try await task.value
    }
    #endif
    throw NSError(domain: "RobbAI", code: 1, userInfo: [NSLocalizedDescriptionKey: Self.availability()["message"] as? String ?? "Apple on-device AI is unavailable."])
  }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
private struct RobbIntent: Codable {
  var action: String
  var kind: String
  var amount: String
  var currency: String
  var title: String
  var date: String
  var wallet: String
  var destination: String
  var category: String
  var tags: [String]
  var start: String
  var end: String
  var search: String
}
#endif
