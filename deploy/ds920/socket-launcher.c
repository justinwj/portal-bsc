// Pre-bind with restrictive permissions, then use Nginx's inherited-listener API.
// Stock Nginx chmods newly bound Unix sockets 0666, independently of umask.
#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/time.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

static const char *directory = "/run/portal", *path = "/run/portal/portal.sock";
static void fail(const char *message) { fprintf(stderr, "portal-socket: %s\n", message); exit(1); }
static int connection(void) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) fail("socket creation failed");
    struct timeval timeout = {.tv_sec = 2};
    if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) ||
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout))) fail("timeout setup failed");
    return fd;
}
int main(int argc, char **argv) {
    struct sockaddr_un address = {.sun_family = AF_UNIX};
    strcpy(address.sun_path, path);
    if (argc == 2 && !strcmp(argv[1], "--check")) {
        int fd = connection(); char response[256] = {0};
        const char *request = "GET /__portal_proxy_health HTTP/1.0\r\nHost: localhost\r\n\r\n";
        if (connect(fd, (struct sockaddr *)&address, sizeof(address)) ||
            send(fd, request, strlen(request), MSG_NOSIGNAL) != (ssize_t)strlen(request) ||
            recv(fd, response, sizeof(response)-1, 0) < 12) fail("Nginx socket health unavailable");
        close(fd);
        return strncmp(response, "HTTP/1.1 204", 12) && strncmp(response, "HTTP/1.0 204", 12) ? 1 : 0;
    }
    if (argc != 1 && !(argc == 2 && !strcmp(argv[1], "--test"))) fail("expected --check, --test, or no arguments");
    if (geteuid() != 0) fail("requires the existing root Nginx master");
    const char *input = getenv("PORTAL_SOCKET_GID"); char *end;
    if (!input || !*input || strspn(input, "0123456789") != strlen(input)) fail("PORTAL_SOCKET_GID must be explicit numeric group ID");
    errno = 0; unsigned long group = strtoul(input, &end, 10);
    if (errno || *end || group >= UINT_MAX) fail("invalid PORTAL_SOCKET_GID");
    struct stat st;
    if (lstat(directory, &st) || !S_ISDIR(st.st_mode) || st.st_uid != 0 || st.st_gid != group ||
        ((st.st_mode & 0777) != 0750 && (st.st_mode & 0777) != 0700)) fail("socket directory must exist, root-owned, correct group, mode 0750 or 0700");
    // Serialize launcher attempts, without following or replacing unrelated files.
    umask(077);
    int lock = open("/run/portal/.listener.lock", O_CREAT|O_RDWR|O_NOFOLLOW|O_CLOEXEC, 0600);
    if (lock < 0 || fstat(lock, &st) || !S_ISREG(st.st_mode) || st.st_uid != 0 ||
        (st.st_mode & 0777) != 0600 || st.st_nlink != 1 || flock(lock, LOCK_EX|LOCK_NB)) fail("unsafe or busy launcher lock");
    if (!lstat(path, &st)) {
        if (!S_ISSOCK(st.st_mode) || st.st_uid != 0 || st.st_gid != group || (st.st_mode & 0777) != 0660)
            fail("refusing to replace an unexpected socket path");
        int probe = connection();
        if (!connect(probe, (struct sockaddr *)&address, sizeof(address))) fail("listener already active");
        int reason = errno; close(probe);
        if (reason != ECONNREFUSED || unlink(path)) fail("cannot safely remove stale socket");
    } else if (errno != ENOENT) fail("cannot inspect socket path");
    int fd = connection();
    if (bind(fd, (struct sockaddr *)&address, sizeof(address)) || chown(path, 0, (gid_t)group) ||
        chmod(path, 0660) || listen(fd, 511)) fail("restricted listener initialization failed");
    char inherited[32]; snprintf(inherited, sizeof(inherited), "%d;", fd);
    if (setenv("NGINX", inherited, 1)) fail("cannot pass listener to Nginx");
    // exec preserves the listener; the short-lived lock closes at exec.
    if (argc == 2) execlp("nginx", "nginx", "-t", (char *)NULL);
    else execlp("nginx", "nginx", "-g", "daemon off;", (char *)NULL);
    fail("cannot execute Nginx");
}
