package io.github.w1249178256.xyzwhelper;

import java.net.IDN;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Validation and same-origin checks for the configured server address. */
public final class ServerAddressPolicy {
    private ServerAddressPolicy() {}

    /**
     * Validates and canonicalizes a server origin. Only a root slash is accepted and removed;
     * paths, credentials, query strings and fragments are rejected.
     */
    public static String normalizeOrigin(String address, boolean allowHttp) {
        if (address == null || address.trim().isEmpty()) {
            throw new IllegalArgumentException("请输入服务器 HTTPS 地址");
        }

        final URI uri;
        try {
            uri = new URI(address.trim());
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("服务器地址格式无效", exception);
        }

        String scheme = uri.getScheme();
        if (scheme == null) {
            throw new IllegalArgumentException("地址必须以 https:// 开头");
        }
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!"https".equals(scheme) && !("http".equals(scheme) && allowHttp)) {
            throw new IllegalArgumentException("正式版仅支持 HTTPS 服务器地址");
        }
        if (uri.isOpaque() || uri.getRawUserInfo() != null) {
            throw new IllegalArgumentException("服务器地址不能包含用户名或密码");
        }
        String path = uri.getRawPath();
        if (path != null && !path.isEmpty() && !"/".equals(path)) {
            throw new IllegalArgumentException("请只填写服务器地址，不要包含路径");
        }
        if (uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("服务器地址不能包含查询参数或片段");
        }

        String host = uri.getHost();
        if (host == null || host.isEmpty()) {
            throw new IllegalArgumentException("服务器地址需要有效的主机名或 IP 地址");
        }
        if (uri.getPort() == 0 || uri.getPort() > 65535) {
            throw new IllegalArgumentException("服务器端口无效");
        }

        final String normalizedHost;
        try {
            normalizedHost = host.startsWith("[")
                    ? host.toLowerCase(Locale.ROOT)
                    : IDN.toASCII(host).toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("服务器主机名无效", exception);
        }

        int port = uri.getPort();
        if (("https".equals(scheme) && port == 443) || ("http".equals(scheme) && port == 80)) {
            port = -1;
        }
        return scheme + "://" + normalizedHost + (port < 0 ? "" : ":" + port);
    }

    /** Returns true only when a URL has the exact configured scheme, host and effective port. */
    public static boolean isSameOrigin(String configuredOrigin, String candidateUrl, boolean allowHttp) {
        if (candidateUrl == null) return false;
        try {
            String trusted = normalizeOrigin(configuredOrigin, allowHttp);
            URI candidate = new URI(candidateUrl);
            if (candidate.getRawUserInfo() != null || candidate.getRawAuthority() == null) return false;
            String candidateOrigin = candidate.getScheme() + "://" + candidate.getRawAuthority();
            return trusted.equals(normalizeOrigin(candidateOrigin, allowHttp));
        } catch (IllegalArgumentException | URISyntaxException exception) {
            return false;
        }
    }
}
