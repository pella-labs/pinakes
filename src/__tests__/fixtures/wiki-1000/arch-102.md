---
source: extracted
---
# Leader Election Pattern

## Why

Some operations need a single coordinator: cron jobs, cache warming, partition assignment. **Leader election** ensures only one instance performs the task.

## Approaches

### Database Lock
```sql
INSERT INTO leader_lock (resource, holder, expires_at)
VALUES ('cron-scheduler', 'instance-A', NOW() + INTERVAL '30 seconds')
ON CONFLICT (resource) DO UPDATE
SET holder = 'instance-A', expires_at = NOW() + INTERVAL '30 seconds'
WHERE leader_lock.expires_at < NOW();
```

### ZooKeeper / etcd
Use ephemeral nodes (ZK) or lease-based keys (etcd). When the leader crashes, the ephemeral node disappears and a new leader is elected.

### Kubernetes Lease
```yaml
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: my-scheduler-lock
```

## Failure Detection

Leaders must renew their lease periodically. If they fail to renew, another instance takes over. Set lease duration based on acceptable failover time.

See [[arch-086]], [[k8s-deployment]].
