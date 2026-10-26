# Paperclip Systemd Service Deployment

Paperclip supports two systemd service modes for automatic startup and recovery:

1. **User Service** (default) - runs in user session, recommended for desktop/laptop deployments
2. **System Service** - runs system-wide, recommended for deployment machines and servers

## User Service (Default)

### Installation

```sh
paperclipai service install
```

This installs Paperclip as a systemd user service. On Linux, the installer may prompt to enable user lingering:

```sh
paperclipai service install --enable-linger
```

Lingering allows the service to start automatically after system reboot without an active login session.

### Service Features

- Auto-starts on login (or system boot with lingering enabled)
- Restarts automatically on failure with 5-second backoff
- Maximum 5 restart attempts per 60 seconds
- Graceful shutdown with 300-second timeout
- Preserves agent run state through restarts

### Verification

```sh
paperclipai service status
```

Check logs:

```sh
paperclipai service logs -f
```

### Disabling Auto-start

If you want the service to not start on login:

```sh
paperclipai service install --no-start-on-login
```

## System Service (Deployment Mode)

For deployment machines, containers, and server environments where systemd user manager is unavailable:

```sh
paperclipai service install --system-service
```

This requires `sudo` access. The service:
- Runs as the `paperclip` system user
- Auto-starts on system boot (multi-user.target)
- Works in containerized environments
- Requires elevated privileges to manage
- Preserves agent run state through restarts

### Verification

```sh
paperclipai service status --system-service
```

Check logs:

```sh
paperclipai service logs -f --system-service
```

### Auto-detection

If systemd user manager is unavailable, the installer automatically falls back to system service mode:

```sh
paperclipai service install  # Auto-detects and uses system service
```

## Hot Restart

Both service modes support hot-restart, preserving active agent runs:

```sh
paperclipai service restart
```

With specific version requirement:

```sh
paperclipai service restart --expected-version 2026.720.0
```

Wait for active runs to drain:

```sh
paperclipai service restart --wait
```

## Node.js Version Management

Managed Paperclip installations pin the validated Node executable in the service definition. After changing Node.js versions:

1. Update the managed installation:

```sh
npx paperclipai@latest install --yes
```

2. Restart the service:

```sh
paperclipai service restart
```

Source checkout installations must configure their own executable path and `PATH` environment. Verify the running Node executable:

```sh
ps aux | grep paperclipai
```

Or check directly:

```sh
cat /etc/systemd/system/paperclipai.service  # System service
cat ~/.config/systemd/user/paperclipai.service  # User service
```

## Systemd Service Definition

### User Service

Located at `~/.config/systemd/user/paperclipai.service`:

- Runs in user session (requires active session or lingering)
- WantedBy: `default.target`
- Working directory: user home

### System Service

Located at `/etc/systemd/system/paperclipai.service`:

- Runs system-wide
- WantedBy: `multi-user.target`
- User: `paperclip`
- Working directory: `/var/lib/paperclip-<user>`

## Troubleshooting

### Service fails to start

```sh
paperclipai service logs -f
journalctl -u paperclipai.service -f  # User service
sudo journalctl -u paperclipai.service -f  # System service
```

### "No usable systemd user manager detected"

This occurs when:
- Running in a container without systemd user manager
- WSL1 (upgrade to WSL2)
- systemd user session is not running

**Solution**: Use system service mode:

```sh
paperclipai service install --system-service
```

Or run Paperclip in foreground mode without a service:

```sh
paperclipai run
```

### Service won't auto-start after reboot

For user service, ensure lingering is enabled:

```sh
paperclipai service status  # Check linger status
paperclipai service install --enable-linger
```

### Hot restart fails during active agent runs

Wait for active runs to complete:

```sh
paperclipai service restart --wait
```

This waits for agent runs to finish before restarting, preserving all state.

## Comparison Table

| Feature | User Service | System Service |
|---------|---|---|
| Setup complexity | Simple | Requires sudo |
| Auto-start on reboot | Yes (with linger) | Yes |
| Restart on failure | Yes | Yes |
| Requires login session | Yes (unless lingering) | No |
| Container friendly | No (WSL2 only) | Yes |
| Hot restart | Yes | Yes |
| State preservation | Yes | Yes |
| Multi-user support | Per-user service | Single system service |

## Best Practices

1. **Desktop/Laptop**: Use user service with lingering enabled
2. **Server/Deployment**: Use system service mode (`--system-service`)
3. **Container/Docker**: Use system service or foreground mode
4. **Development**: Use foreground mode (`paperclipai run`)
5. **High availability**: Monitor with external tools (systemd-watchdog available for future enhancement)

## Environment Variables

The service sets:

- `PAPERCLIP_SERVICE_MANAGED=1` - indicates managed service environment
- `PAPERCLIP_INSTANCE_ID=<id>` - instance identifier
- `PAPERCLIP_HOME=<home>` - Paperclip home directory

Additional environment variables can be configured by editing the service definition file directly and reloading:

```sh
systemctl --user daemon-reload  # User service
sudo systemctl daemon-reload  # System service
```

## Resource Usage

- CPU: Idle ~0%, active varies by agent workload
- Memory: Base ~100-200MB, grows with agent workspace size
- Disk I/O: Minimal in steady state, peak during agent runs
- Network: Efficient event-driven architecture (no polling)
