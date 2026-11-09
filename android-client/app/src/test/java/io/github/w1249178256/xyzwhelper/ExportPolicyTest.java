package io.github.w1249178256.xyzwhelper;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.Test;

public final class ExportPolicyTest {
    private static final String NONCE = "0123456789abcdefghijklmnopqrstuv";

    @Test
    public void parsesJsonBlobAndSanitizesFilename() {
        byte[] contents = "hello export".getBytes(StandardCharsets.UTF_8);
        String dataUrl = "data:application/json;base64," + Base64.getEncoder().encodeToString(contents);
        ExportPolicy.ExportData result = ExportPolicy.parsePayload(
                payload(NONCE, "../bad\\tokens.json", "application/json", dataUrl), NONCE);

        assertEquals("tokens.json", result.getFilename());
        assertEquals("application/json", result.getMimeType());
        assertArrayEquals(contents, result.getBytes());
        result.clear();
        assertArrayEquals(new byte[contents.length], result.getBytes());
    }

    @Test
    public void rejectsStaleNonceAndUnknownFields() {
        String dataUrl = "data:application/octet-stream;base64,AA==";
        expectError("stale", () -> ExportPolicy.parsePayload(
                payload("another-nonce", "export.bin", "application/octet-stream", dataUrl), NONCE));
        expectError("invalid", () -> ExportPolicy.parsePayload(
                "{\"nonce\":\"" + NONCE + "\",\"name\":\"x\",\"type\":\"application/octet-stream\","
                        + "\"data\":\"" + dataUrl + "\",\"path\":\"/tmp/x\"}", NONCE));
    }

    @Test
    public void rejectsMalformedBase64AndMismatchedMime() {
        expectError("invalid", () -> ExportPolicy.parsePayload(
                payload(NONCE, "bad.bin", "application/octet-stream",
                        "data:application/octet-stream;base64,ab!="), NONCE));
        expectError("invalid", () -> ExportPolicy.parsePayload(
                payload(NONCE, "bad.bin", "image/png", "data:application/json;base64,AA=="), NONCE));
    }

    @Test
    public void rejectsPayloadsAboveEightMibBeforeDecoding() {
        String oversized = "A".repeat(((ExportPolicy.MAX_EXPORT_BYTES + 2) / 3) * 4 + 4);
        String dataUrl = "data:application/octet-stream;base64," + oversized;
        expectError("too_large", () -> ExportPolicy.parsePayload(
                payload(NONCE, "large.bin", "application/octet-stream", dataUrl), NONCE));
    }

    @Test
    public void acceptsNativeErrorNotificationsWithoutOpeningAFile() {
        expectError("read_failed", () -> ExportPolicy.parsePayload(
                "{\"nonce\":\"" + NONCE + "\",\"error\":\"read_failed\"}", NONCE));
    }

    private static String payload(String nonce, String filename, String mimeType, String data) {
        return "{\"nonce\":" + jsonString(nonce) + ",\"name\":" + jsonString(filename)
                + ",\"type\":" + jsonString(mimeType) + ",\"data\":" + jsonString(data) + "}";
    }

    private static String jsonString(String value) {
        return "\"" + value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t") + "\"";
    }

    private static void expectError(String expectedCode, Runnable operation) {
        try {
            operation.run();
            fail("Expected ExportPolicy.ExportError");
        } catch (ExportPolicy.ExportError error) {
            assertEquals(expectedCode, error.getCode());
        }
    }
}
