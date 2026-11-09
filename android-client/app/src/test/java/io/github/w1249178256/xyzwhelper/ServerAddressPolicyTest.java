package io.github.w1249178256.xyzwhelper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ServerAddressPolicyTest {
    @Test
    public void canonicalizesHttpsOrigin() {
        assertEquals("https://example.com", ServerAddressPolicy.normalizeOrigin("HTTPS://Example.COM:443/", false));
        assertEquals("https://example.com:8443", ServerAddressPolicy.normalizeOrigin("https://Example.com:8443", false));
    }

    @Test
    public void debugCanUseHttpButReleaseCannot() {
        assertEquals("http://192.168.1.8:8080", ServerAddressPolicy.normalizeOrigin("HTTP://192.168.1.8:8080", true));
        assertThrows(IllegalArgumentException.class, () -> ServerAddressPolicy.normalizeOrigin("http://192.168.1.8:8080", false));
    }

    @Test
    public void rejectsCredentialsPathsQueriesFragmentsAndUnsafeSchemes() {
        assertThrows(IllegalArgumentException.class, () -> ServerAddressPolicy.normalizeOrigin("https://user:secret@example.com", false));
        assertThrows(IllegalArgumentException.class, () -> ServerAddressPolicy.normalizeOrigin("https://example.com/server", false));
        assertThrows(IllegalArgumentException.class, () -> ServerAddressPolicy.normalizeOrigin("https://example.com?x=1", false));
        assertThrows(IllegalArgumentException.class, () -> ServerAddressPolicy.normalizeOrigin("https://example.com#server", false));
        assertThrows(IllegalArgumentException.class, () -> ServerAddressPolicy.normalizeOrigin("javascript:alert(1)", true));
        assertThrows(IllegalArgumentException.class, () -> ServerAddressPolicy.normalizeOrigin("file:///etc/passwd", true));
    }

    @Test
    public void sameOriginUsesExactSchemeHostAndPort() {
        String trusted = "https://example.com:8443";
        assertTrue(ServerAddressPolicy.isSameOrigin(trusted, "https://example.com:8443/server", false));
        assertTrue(ServerAddressPolicy.isSameOrigin(trusted, "https://example.com:8443/tokens?tab=1", false));
        assertFalse(ServerAddressPolicy.isSameOrigin(trusted, "https://example.com.evil.test:8443/server", false));
        assertFalse(ServerAddressPolicy.isSameOrigin(trusted, "http://example.com:8443/server", false));
        assertFalse(ServerAddressPolicy.isSameOrigin(trusted, "https://example.com/server", false));
        assertFalse(ServerAddressPolicy.isSameOrigin(trusted, "https://user@example.com:8443/server", false));
        assertFalse(ServerAddressPolicy.isSameOrigin(trusted, "javascript:alert(1)", false));
    }
}
