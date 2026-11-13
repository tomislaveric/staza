import XCTest
@testable import Staza

@MainActor
final class AuthFlowModelTests: XCTestCase {
    private func makeFlow(_ stubs: [StubTransport.Stub]) -> (AuthFlowModel, StubTransport, AuthState) {
        let transport = StubTransport(stubs)
        let state = AuthState()
        let manager = SessionManager(store: MemoryCredentialStore(), refreshClient: APIClient(baseURL: baseURL, transport: transport), authState: state)
        let client = APIClient(baseURL: baseURL, transport: transport, tokenProvider: manager)
        let flow = AuthFlowModel(service: AuthService(api: client, session: manager, passkeys: SystemPasskeyAuthorizer()))
        flow.email = " A@B.c "
        return (flow, transport, state)
    }

    func testRequestCodeFailureStaysOnEmailStepWithError() async {
        let (flow, _, _) = makeFlow([.init(status: 429, body: #"{"error":"Too many requests."}"#)])
        await flow.requestCode()
        XCTAssertEqual(flow.step, .enterEmail)
        XCTAssertEqual(flow.errorMessage, "Too many requests.")
        XCTAssertFalse(flow.isBusy)
    }

    func testResendRequestsANewCodeAndClearsTheTypedOne() async {
        let (flow, transport, _) = makeFlow([.init(status: 202, body: "{}"), .init(status: 202, body: "{}")])
        await flow.requestCode()
        XCTAssertEqual(flow.step, .enterCode(email: "a@b.c"))
        flow.code = "1234"
        await flow.requestCode()
        XCTAssertEqual(flow.step, .enterCode(email: "a@b.c"))
        XCTAssertEqual(flow.code, "")
        XCTAssertNil(flow.errorMessage)
        XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/auth/email-code/request", "/api/auth/email-code/request"])
    }

    func testWrongCodeKeepsCodeStepAndDoesNotSignIn() async {
        let (flow, _, state) = makeFlow([
            .init(status: 202, body: "{}"),
            .init(status: 400, body: #"{"error":"The code is invalid or expired."}"#)
        ])
        await flow.requestCode()
        flow.code = "000000"
        await flow.verifyCode()
        XCTAssertEqual(flow.step, .enterCode(email: "a@b.c"))
        XCTAssertEqual(flow.errorMessage, "The code is invalid or expired.")
        XCTAssertNotEqual(state.status, .signedIn)
    }

    func testVerifyWithoutCredentialsReportsError() async {
        let (flow, _, state) = makeFlow([
            .init(status: 202, body: "{}"),
            .init(status: 200, body: #"{"authenticated":true}"#)
        ])
        await flow.requestCode()
        flow.code = "123456"
        await flow.verifyCode()
        XCTAssertNotNil(flow.errorMessage)
        XCTAssertNotEqual(state.status, .signedIn)
    }
}
