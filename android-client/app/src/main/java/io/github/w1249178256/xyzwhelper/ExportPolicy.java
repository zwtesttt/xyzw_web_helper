package io.github.w1249178256.xyzwhelper;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Strict parser and policy for the narrow native file-export prompt. */
public final class ExportPolicy {
    public static final int MAX_EXPORT_BYTES = 8 * 1024 * 1024;

    private static final int MAX_PROMPT_CHARS = 12 * 1024 * 1024;
    private static final int MAX_BASE64_CHARS = ((MAX_EXPORT_BYTES + 2) / 3) * 4;
    private static final Pattern MIME_TYPE = Pattern.compile(
            "^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$");
    private static final Set<String> FILE_FIELDS = new HashSet<>(
            Arrays.asList("nonce", "name", "type", "data"));
    private static final Set<String> ERROR_CODES = new HashSet<>(
            Arrays.asList("too_large", "read_failed", "unsupported"));

    private ExportPolicy() {}

    /** Parses the JSON object sent by the injected bridge; all values must be JSON strings. */
    public static ExportData parsePayload(String payload, String expectedNonce) {
        if (expectedNonce == null || expectedNonce.isEmpty()) {
            throw new ExportError("stale", "The export page is no longer active.");
        }
        if (payload == null || payload.length() > MAX_PROMPT_CHARS) {
            throw new ExportError("too_large", "Export payload is too large.");
        }

        Map<String, String> fields = new JsonStringObjectParser(payload).parse();
        if (!expectedNonce.equals(fields.get("nonce"))) {
            throw new ExportError("stale", "The export page is no longer active.");
        }

        if (fields.containsKey("error")) {
            if (fields.size() != 2 || !fields.containsKey("nonce")) {
                throw new ExportError("invalid", "Invalid export request.");
            }
            String code = fields.get("error");
            if (!ERROR_CODES.contains(code)) {
                throw new ExportError("invalid", "Invalid export request.");
            }
            throw new ExportError(code, "The browser could not prepare this file.");
        }

        if (!fields.keySet().equals(FILE_FIELDS)) {
            throw new ExportError("invalid", "Invalid export request.");
        }

        String mimeType = normalizeMime(fields.get("type"));
        String dataUrl = fields.get("data");
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:") || comma < 6 || comma > 160) {
            throw new ExportError("invalid", "Invalid export data URL.");
        }
        String metadata = dataUrl.substring(5, comma);
        String lowerMetadata = metadata.toLowerCase(Locale.ROOT);
        if (!lowerMetadata.endsWith(";base64")) {
            throw new ExportError("invalid", "Only base64 export data is accepted.");
        }
        String dataMime = normalizeMime(metadata.substring(0, metadata.length() - ";base64".length()));
        if (!mimeType.equals(dataMime)) {
            throw new ExportError("invalid", "Export type does not match its data.");
        }

        String encoded = dataUrl.substring(comma + 1);
        int estimatedBytes = decodedLength(encoded);
        if (estimatedBytes > MAX_EXPORT_BYTES) {
            throw new ExportError("too_large", "Export exceeds the 8 MiB limit.");
        }

        final byte[] bytes;
        try {
            bytes = java.util.Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException exception) {
            throw new ExportError("invalid", "Invalid base64 export data.");
        }
        if (bytes.length > MAX_EXPORT_BYTES) {
            Arrays.fill(bytes, (byte) 0);
            throw new ExportError("too_large", "Export exceeds the 8 MiB limit.");
        }

        return new ExportData(sanitizeFilename(fields.get("name")), mimeType, bytes);
    }

    private static int decodedLength(String encoded) {
        int length = encoded.length();
        if (length == 0) return 0;
        if (length > MAX_BASE64_CHARS || length % 4 != 0) {
            throw new ExportError(length > MAX_BASE64_CHARS ? "too_large" : "invalid",
                    "Invalid base64 export length.");
        }

        int padding = 0;
        if (encoded.endsWith("=")) padding++;
        if (encoded.endsWith("==")) padding++;
        for (int index = 0; index < length - padding; index++) {
            char value = encoded.charAt(index);
            boolean valid = value >= 'A' && value <= 'Z'
                    || value >= 'a' && value <= 'z'
                    || value >= '0' && value <= '9'
                    || value == '+' || value == '/';
            if (!valid) throw new ExportError("invalid", "Invalid base64 export data.");
        }
        for (int index = length - padding; index < length; index++) {
            if (encoded.charAt(index) != '=') {
                throw new ExportError("invalid", "Invalid base64 export padding.");
            }
        }
        int decoded = (length / 4) * 3 - padding;
        if (decoded > MAX_EXPORT_BYTES) {
            throw new ExportError("too_large", "Export exceeds the 8 MiB limit.");
        }
        return decoded;
    }

    private static String normalizeMime(String value) {
        if (value == null || value.length() > 127) {
            throw new ExportError("invalid", "Invalid file type.");
        }
        String normalized = value.toLowerCase(Locale.ROOT);
        if (!MIME_TYPE.matcher(normalized).matches()) {
            throw new ExportError("invalid", "Invalid file type.");
        }
        return normalized;
    }

    static String sanitizeFilename(String name) {
        String candidate = name == null ? "" : name.trim().replace('\\', '/');
        int separator = candidate.lastIndexOf('/');
        if (separator >= 0) candidate = candidate.substring(separator + 1);

        StringBuilder safe = new StringBuilder(candidate.length());
        for (int index = 0; index < candidate.length(); index++) {
            char value = candidate.charAt(index);
            if (Character.isISOControl(value) || ":*?\"<>|/\\".indexOf(value) >= 0) {
                safe.append('_');
            } else {
                safe.append(value);
            }
        }
        String result = safe.toString().trim();
        while (result.startsWith(".")) result = result.substring(1);
        while (result.endsWith(".")) result = result.substring(0, result.length() - 1);
        if (result.isEmpty()) result = "export.bin";
        int codePoints = result.codePointCount(0, result.length());
        if (codePoints > 120) {
            result = result.substring(0, result.offsetByCodePoints(0, 120));
        }
        return result;
    }

    public static final class ExportData {
        private final String filename;
        private final String mimeType;
        private final byte[] bytes;

        private ExportData(String filename, String mimeType, byte[] bytes) {
            this.filename = filename;
            this.mimeType = mimeType;
            this.bytes = bytes;
        }

        public String getFilename() { return filename; }
        public String getMimeType() { return mimeType; }
        public byte[] getBytes() { return bytes; }

        public void clear() {
            Arrays.fill(bytes, (byte) 0);
        }
    }

    public static final class ExportError extends IllegalArgumentException {
        private final String code;

        private ExportError(String code, String message) {
            super(message);
            this.code = code;
        }

        public String getCode() { return code; }
    }

    private static final class JsonStringObjectParser {
        private final String input;
        private int offset;

        private JsonStringObjectParser(String input) {
            this.input = input;
        }

        private Map<String, String> parse() {
            Map<String, String> values = new HashMap<>();
            skipWhitespace();
            expect('{');
            skipWhitespace();
            if (peek('}')) {
                offset++;
                finish();
                return values;
            }
            while (true) {
                skipWhitespace();
                String key = parseString();
                skipWhitespace();
                expect(':');
                skipWhitespace();
                String value = parseString();
                if (values.putIfAbsent(key, value) != null) {
                    throw new ExportError("invalid", "Duplicate JSON field.");
                }
                skipWhitespace();
                if (peek('}')) {
                    offset++;
                    finish();
                    return values;
                }
                expect(',');
            }
        }

        private String parseString() {
            expect('"');
            StringBuilder value = new StringBuilder();
            while (offset < input.length()) {
                char current = input.charAt(offset++);
                if (current == '"') return value.toString();
                if (current < 0x20) throw new ExportError("invalid", "Invalid JSON string.");
                if (current != '\\') {
                    value.append(current);
                    continue;
                }
                if (offset >= input.length()) throw new ExportError("invalid", "Invalid JSON escape.");
                char escaped = input.charAt(offset++);
                switch (escaped) {
                    case '"': value.append('"'); break;
                    case '\\': value.append('\\'); break;
                    case '/': value.append('/'); break;
                    case 'b': value.append('\b'); break;
                    case 'f': value.append('\f'); break;
                    case 'n': value.append('\n'); break;
                    case 'r': value.append('\r'); break;
                    case 't': value.append('\t'); break;
                    case 'u': value.append(parseUnicodeEscape()); break;
                    default: throw new ExportError("invalid", "Invalid JSON escape.");
                }
            }
            throw new ExportError("invalid", "Unterminated JSON string.");
        }

        private char parseUnicodeEscape() {
            if (offset + 4 > input.length()) {
                throw new ExportError("invalid", "Invalid JSON unicode escape.");
            }
            int value = 0;
            for (int count = 0; count < 4; count++) {
                int digit = Character.digit(input.charAt(offset++), 16);
                if (digit < 0) throw new ExportError("invalid", "Invalid JSON unicode escape.");
                value = (value << 4) | digit;
            }
            return (char) value;
        }

        private void skipWhitespace() {
            while (offset < input.length()) {
                char value = input.charAt(offset);
                if (value != ' ' && value != '\n' && value != '\r' && value != '\t') return;
                offset++;
            }
        }

        private boolean peek(char expected) {
            return offset < input.length() && input.charAt(offset) == expected;
        }

        private void expect(char expected) {
            if (!peek(expected)) throw new ExportError("invalid", "Malformed export request.");
            offset++;
        }

        private void finish() {
            skipWhitespace();
            if (offset != input.length()) throw new ExportError("invalid", "Trailing JSON content.");
        }
    }
}
