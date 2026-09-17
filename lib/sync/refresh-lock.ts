type RpcError = { message: string } | null;

export type RefreshLockClient = {
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError }>;
};

interface RefreshLockInput {
  admin: RefreshLockClient;
  source: string;
  ttlSeconds?: number;
}

export async function withRefreshLock<T>(
  input: RefreshLockInput,
  operation: () => Promise<T>,
): Promise<T> {
  const ownerToken = crypto.randomUUID();
  const { data: acquired, error: acquireError } = await input.admin.rpc(
    'acquire_sync_refresh_lock',
    {
      p_source: input.source,
      p_owner_token: ownerToken,
      p_ttl_seconds: input.ttlSeconds ?? 600,
    },
  );

  if (acquireError) {
    throw new Error(`Could not acquire refresh lock: ${acquireError.message}`);
  }
  if (acquired !== true) {
    throw new Error('A refresh is already in progress. Try again after it finishes.');
  }

  let operationResult: T | undefined;
  let operationError: unknown;
  let operationFailed = false;

  try {
    operationResult = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  const { error: releaseError } = await input.admin.rpc(
    'release_sync_refresh_lock',
    {
      p_source: input.source,
      p_owner_token: ownerToken,
    },
  );

  if (operationFailed) {
    if (releaseError) {
      throw new AggregateError(
        [
          operationError,
          new Error(`Could not release refresh lock: ${releaseError.message}`),
        ],
        'Refresh failed and its lock could not be released.',
      );
    }
    throw operationError;
  }
  if (releaseError) {
    throw new Error(`Could not release refresh lock: ${releaseError.message}`);
  }

  return operationResult as T;
}
