import { memo, useEffect, useState } from "react";
import { Clock3, Gamepad2, LibraryBig, Rocket, Timer } from "lucide-react";
import { StatGroup, StatTile } from "@/components/home/StatTile";
import {
  formatDuration,
  getWeeklyActivity,
} from "@/services/library/weeklyActivityService";
import { imageDataUrlFromBase64, sanitizeText } from "@/lib/utils";

const ICON = "h-5 w-5 shrink-0";

const HoursChart = ({ days }) => {
  const max = Math.max(...days.map(day => day.seconds), 1);
  return (
    <div className="flex items-end gap-1.5" aria-hidden="true">
      {days.map(day => (
        <div key={day.key} className="flex flex-col items-center gap-1">
          <div className="relative flex h-14 w-5 items-end overflow-hidden rounded-[3px] bg-muted">
            <div
              className="w-full rounded-[3px] bg-foreground/90 transition-[height] duration-700"
              style={{
                height: `${Math.max(day.seconds > 0 ? 12 : 0, (day.seconds / max) * 100)}%`,
              }}
            />
          </div>
          <span className="text-[11px] font-semibold uppercase text-muted-foreground/60">
            {day.label}
          </span>
        </div>
      ))}
    </div>
  );
};

const FavoriteCover = ({ name }) => {
  const [image, setImage] = useState(null);
  useEffect(() => {
    let active = true;
    setImage(null);
    if (!name) return undefined;
    window.electron
      .getGameImage(name)
      .then(base64 => active && base64 && setImage(imageDataUrlFromBase64(base64)))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [name]);

  return (
    <div className="flex h-[132px] w-[132px] items-center justify-center overflow-hidden rounded-[10px] bg-card">
      {image ? (
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        <Gamepad2 className="h-7 w-7 text-muted-foreground/50" strokeWidth={1.5} />
      )}
    </div>
  );
};

/**
 * Seven days of local play activity, read from the snapshots the navigation
 * rail records whenever it reads the library.
 */
const WeeklyStats = memo(({ t, locale, refreshKey }) => {
  const [stats, setStats] = useState(() => getWeeklyActivity(locale));

  useEffect(() => {
    setStats(getWeeklyActivity(locale));
  }, [locale, refreshKey]);

  const favorite = stats.favorite;

  return (
    <section>
      <h2 className="mb-5 mt-0 text-[1.375rem] font-semibold tracking-tight text-foreground">
        {t("home.weekly.title")}
      </h2>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <StatGroup>
          <StatTile
            label={t("home.weekly.hoursPlayed")}
            valueClassName="justify-between gap-6 px-6 py-3"
          >
            <span className="flex items-center gap-2">
              {formatDuration(stats.totalSeconds)}
              <Clock3 className={ICON} strokeWidth={1.75} />
            </span>
            <HoursChart days={stats.days} />
          </StatTile>
        </StatGroup>

        <StatGroup>
          <StatTile label={t("home.weekly.newGames")}>
            {stats.newGames}
            <Gamepad2 className={ICON} strokeWidth={1.75} />
          </StatTile>
          <StatTile label={t("home.weekly.launches")}>
            {stats.launches}
            <Rocket className={ICON} strokeWidth={1.75} />
          </StatTile>
        </StatGroup>

        <StatGroup className="grid-flow-row grid-cols-[132px_minmax(0,1fr)]">
          <FavoriteCover name={favorite?.name} />
          <StatTile
            label={t("home.weekly.favoriteGame")}
            valueClassName="flex-col gap-1 px-4 text-center"
          >
            <span className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-normal">
              {favorite ? sanitizeText(favorite.name) : "—"}
            </span>
            <span className="text-[13px] font-normal tracking-normal text-muted-foreground/70">
              {favorite
                ? t("home.weekly.favoriteHours", {
                    hours: formatDuration(favorite.seconds),
                  })
                : t("home.weekly.noFavorite")}
            </span>
          </StatTile>
        </StatGroup>

        <StatGroup>
          <StatTile label={t("home.weekly.avgSession")}>
            {formatDuration(stats.avgSessionSeconds)}
            <Timer className={ICON} strokeWidth={1.75} />
          </StatTile>
          <StatTile label={t("home.weekly.installed")}>
            {stats.libraryCount}
            <LibraryBig className={ICON} strokeWidth={1.75} />
          </StatTile>
        </StatGroup>
      </div>
    </section>
  );
});
WeeklyStats.displayName = "WeeklyStats";

export default WeeklyStats;
