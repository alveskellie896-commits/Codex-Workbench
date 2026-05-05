import XCTest
@testable import CodexWorkbench

final class RuntimeControlsTests: XCTestCase {
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(WorkbenchDateCoding.decodeDate)
        return decoder
    }()

    func testRuntimeControlsDecodeStringBooleansAndNormalizeInvalidValues() throws {
        let data = Data("""
        {
          "model": "gpt-5.4",
          "reasoningEffort": "HIGH",
          "accessMode": "root",
          "planMode": "true"
        }
        """.utf8)

        let controls = try decoder.decode(RuntimeControls.self, from: data)

        XCTAssertEqual(controls.model, "gpt-5.4")
        XCTAssertEqual(controls.reasoningEffort, "high")
        XCTAssertEqual(controls.accessMode, "on-request")
        XCTAssertTrue(controls.planMode)
    }

    func testRuntimeInfoUsesThreadControlsWhenPresent() throws {
        let data = Data("""
        {
          "defaults": {
            "model": "default-model",
            "reasoningEffort": "medium",
            "accessMode": "on-request",
            "planMode": false
          },
          "thread": {
            "model": "thread-model",
            "reasoningEffort": "xhigh",
            "accessMode": "read-only",
            "planMode": 1
          },
          "capabilities": {
            "sendMode": "app-server",
            "controls": {
              "model": { "supported": true },
              "reasoningEffort": { "supported": true, "values": ["low", "medium", "high", "xhigh"] },
              "accessMode": { "supported": true, "values": ["read-only", "on-request", "full-access"] },
              "planMode": { "supported": true },
              "steerActiveRun": { "supported": false, "note": "queued follow-up" }
            }
          },
          "accessModes": [
            { "value": "read-only", "label": "Read-only" },
            { "value": "on-request", "label": "Ask first" }
          ],
          "reasoningEfforts": ["low", "medium", "high", "xhigh"]
        }
        """.utf8)

        let info = try decoder.decode(RuntimeInfo.self, from: data)

        XCTAssertEqual(info.effectiveControls.model, "thread-model")
        XCTAssertEqual(info.effectiveControls.reasoningEffort, "xhigh")
        XCTAssertEqual(info.effectiveControls.accessMode, "read-only")
        XCTAssertTrue(info.effectiveControls.planMode)
        XCTAssertEqual(info.capabilities.sendMode, "app-server")
        XCTAssertFalse(info.capabilities.controls.steerActiveRun.supported)
    }

    func testSendAndFollowUpRequestsEncodeRuntimeControls() throws {
        let controls = RuntimeControls(
            model: "gpt-5.4",
            reasoningEffort: "high",
            accessMode: "read-only",
            planMode: true
        )
        let encoder = JSONEncoder()

        let sendData = try encoder.encode(SendMessageRequest(message: "hello", runtime: controls))
        let followUpData = try encoder.encode(FollowUpRequest(message: "next", runtime: controls))

        let sendJson = String(decoding: sendData, as: UTF8.self)
        let followUpJson = String(decoding: followUpData, as: UTF8.self)

        XCTAssertTrue(sendJson.contains("\"runtime\""))
        XCTAssertTrue(sendJson.contains("\"reasoningEffort\":\"high\""))
        XCTAssertTrue(sendJson.contains("\"queueIfRunning\":true"))
        XCTAssertTrue(followUpJson.contains("\"runtime\""))
        XCTAssertTrue(followUpJson.contains("\"accessMode\":\"read-only\""))
        XCTAssertTrue(followUpJson.contains("\"planMode\":true"))
    }
}
