import { describeDataSourceMode, getDataSourceMode } from "@/lib/env/mode";

/**
 * Says out loud which data the app is serving whenever that is not fully live.
 *
 * Fake and sandbox modes both fail quietly — every page renders, every sync
 * succeeds, and the numbers are fiction. Renders nothing once SP-API and Ads
 * are both on production, so a correct deploy carries no chrome (issue #28).
 */
export function DataSourceBanner() {
  const mode = getDataSourceMode();

  if (mode.amazon === "production" && mode.ads === "production") return null;

  const className = mode.isMisconfigured
    ? "border-red-500/30 bg-red-500/10 text-red-600"
    : "border-amber-500/30 bg-amber-500/10 text-amber-600";

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-xs md:px-6 ${className}`}
    >
      <span className="font-semibold">
        {mode.isMisconfigured ? "Not live" : "Not live data"}
      </span>
      <span>{describeDataSourceMode(mode)}</span>
      {mode.isMisconfigured ? (
        <span className="text-red-600/80">
          This is the production deploy — these numbers are not real. Set
          AMAZON_USE_FAKE=false and the sandbox flags to false.
        </span>
      ) : null}
    </div>
  );
}
