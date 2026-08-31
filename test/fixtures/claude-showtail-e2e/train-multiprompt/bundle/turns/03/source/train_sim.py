"""Deterministic train schedule simulator.

Models stations, scheduled departures, travel times between stops, and
per-stop delays. Given a set of train schedules, computes actual arrival
and departure times at every stop and a deterministically ordered stream
of arrival/departure events.
"""

from __future__ import annotations

import argparse
import csv
import html
import io
import json
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional


def parse_time(text: str) -> int:
    """Parse an "HH:MM" string into minutes since midnight."""
    parts = text.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"invalid time {text!r}, expected HH:MM")
    hours, minutes = int(parts[0]), int(parts[1])
    if minutes < 0 or minutes > 59 or hours < 0:
        raise ValueError(f"invalid time {text!r}, expected HH:MM")
    return hours * 60 + minutes


def format_time(minutes: int) -> str:
    """Format minutes since midnight as "HH:MM", with a "+Nd" suffix for
    times that roll over into following days."""
    day, remainder = divmod(minutes, 1440)
    hours, mins = divmod(remainder, 60)
    base = f"{hours:02d}:{mins:02d}"
    if day > 0:
        return f"{base}+{day}d"
    return base


@dataclass(frozen=True)
class Stop:
    """A single stop on a train's route.

    scheduled_departure is None for the final stop of a route, which is
    arrival-only. travel_time is the minutes to the next stop (0 for the
    final stop). delay is extra minutes added at this stop before the
    train departs (e.g. boarding delay), applied on top of any delay
    already carried forward from earlier stops.
    """

    station: str
    scheduled_departure: Optional[int]
    travel_time: int = 0
    delay: int = 0


@dataclass(frozen=True)
class TrainSchedule:
    train_id: str
    stops: List[Stop] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.stops:
            raise ValueError(f"train {self.train_id!r} has no stops")
        if self.stops[0].scheduled_departure is None:
            raise ValueError(
                f"train {self.train_id!r} first stop must have a scheduled departure"
            )
        for stop in self.stops[:-1]:
            if stop.scheduled_departure is None:
                raise ValueError(
                    f"train {self.train_id!r} intermediate stop "
                    f"{stop.station!r} must have a scheduled departure"
                )


@dataclass(frozen=True)
class SimulatedStop:
    station: str
    arrival: Optional[int]
    departure: Optional[int]


@dataclass(frozen=True)
class Event:
    time: int
    train_id: str
    station: str
    kind: str  # "arrival" or "departure"
    seq: int  # position of this stop within the train's route, for tie-breaks

    def sort_key(self):
        kind_rank = 0 if self.kind == "arrival" else 1
        return (self.time, self.train_id, self.seq, kind_rank)


def simulate_train(train: TrainSchedule) -> List[SimulatedStop]:
    """Compute actual arrival/departure times for every stop of a train,
    propagating delays forward from the first stop."""
    results: List[SimulatedStop] = []
    previous_departure: Optional[int] = None
    previous_travel_time = 0

    for index, stop in enumerate(train.stops):
        is_first = index == 0
        is_last = index == len(train.stops) - 1

        if is_first:
            arrival = None
            departure = stop.scheduled_departure + stop.delay
        else:
            arrival = previous_departure + previous_travel_time
            departure = None if is_last else arrival + stop.delay

        results.append(SimulatedStop(station=stop.station, arrival=arrival, departure=departure))
        previous_departure = departure
        previous_travel_time = stop.travel_time

    return results


def simulate_all(trains: List[TrainSchedule]) -> Dict[str, List[SimulatedStop]]:
    return {train.train_id: simulate_train(train) for train in trains}


def build_events(trains: List[TrainSchedule], results: Dict[str, List[SimulatedStop]]) -> List[Event]:
    """Build a deterministically ordered list of arrival/departure events
    across all trains, sorted by time, then train id, then stop order."""
    events: List[Event] = []
    for train in trains:
        for seq, sim_stop in enumerate(results[train.train_id]):
            if sim_stop.arrival is not None:
                events.append(
                    Event(sim_stop.arrival, train.train_id, sim_stop.station, "arrival", seq)
                )
            if sim_stop.departure is not None:
                events.append(
                    Event(sim_stop.departure, train.train_id, sim_stop.station, "departure", seq)
                )
    events.sort(key=Event.sort_key)
    return events


def format_schedule_table(trains: List[TrainSchedule]) -> str:
    lines = ["Scheduled timetable:"]
    for train in trains:
        lines.append(f"  Train {train.train_id}:")
        for stop in train.stops:
            dep = format_time(stop.scheduled_departure) if stop.scheduled_departure is not None else "  -  "
            extra = f" (delay +{stop.delay}m)" if stop.delay else ""
            lines.append(f"    {stop.station:<20} dep {dep}{extra}")
    return "\n".join(lines)


def format_simulation_table(trains: List[TrainSchedule], results: Dict[str, List[SimulatedStop]]) -> str:
    lines = ["Simulated timetable:"]
    for train in trains:
        lines.append(f"  Train {train.train_id}:")
        for sim_stop in results[train.train_id]:
            arr = format_time(sim_stop.arrival) if sim_stop.arrival is not None else "  -  "
            dep = format_time(sim_stop.departure) if sim_stop.departure is not None else "  -  "
            lines.append(f"    {sim_stop.station:<20} arr {arr}  dep {dep}")
    return "\n".join(lines)


def format_events(events: List[Event]) -> str:
    lines = ["Event log:"]
    for event in events:
        lines.append(f"  {format_time(event.time)}  {event.train_id:<8} {event.kind:<10} {event.station}")
    return "\n".join(lines)


def demo_schedule() -> List[TrainSchedule]:
    """A small, fixed set of train schedules used by the CLI when no
    external schedule file is supplied."""
    return [
        TrainSchedule(
            train_id="R101",
            stops=[
                Stop("Central", parse_time("08:00"), travel_time=15),
                Stop("Northgate", parse_time("08:20"), travel_time=20, delay=5),
                Stop("Lakeside", parse_time("08:55"), travel_time=10),
                Stop("Hillcrest", None),
            ],
        ),
        TrainSchedule(
            train_id="R202",
            stops=[
                Stop("Hillcrest", parse_time("08:10"), travel_time=10),
                Stop("Lakeside", parse_time("08:25"), travel_time=20),
                Stop("Northgate", parse_time("08:50"), travel_time=15, delay=8),
                Stop("Central", None),
            ],
        ),
    ]


CSV_FIELDNAMES = ["time_minutes", "time", "train_id", "station", "kind"]


def export_events_csv(events: List[Event]) -> str:
    """Render the event log as CSV text, one row per event in the same
    deterministic order produced by build_events."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_FIELDNAMES, lineterminator="\n")
    writer.writeheader()
    for event in events:
        writer.writerow(
            {
                "time_minutes": event.time,
                "time": format_time(event.time),
                "train_id": event.train_id,
                "station": event.station,
                "kind": event.kind,
            }
        )
    return buffer.getvalue()


def _stop_to_dict(stop: Stop) -> dict:
    return {
        "station": stop.station,
        "scheduled_departure": stop.scheduled_departure,
        "scheduled_departure_formatted": (
            format_time(stop.scheduled_departure) if stop.scheduled_departure is not None else None
        ),
        "travel_time": stop.travel_time,
        "delay": stop.delay,
    }


def _simulated_stop_to_dict(sim_stop: SimulatedStop) -> dict:
    return {
        "station": sim_stop.station,
        "arrival": sim_stop.arrival,
        "arrival_formatted": format_time(sim_stop.arrival) if sim_stop.arrival is not None else None,
        "departure": sim_stop.departure,
        "departure_formatted": format_time(sim_stop.departure) if sim_stop.departure is not None else None,
    }


def _event_to_dict(event: Event) -> dict:
    return {
        "time": event.time,
        "time_formatted": format_time(event.time),
        "train_id": event.train_id,
        "station": event.station,
        "kind": event.kind,
    }


def export_schedule_json(
    trains: List[TrainSchedule],
    results: Dict[str, List[SimulatedStop]],
    events: List[Event],
) -> str:
    """Render the full schedule, simulation results, and event log as a
    single deterministic JSON document."""
    data = {
        "trains": [
            {
                "train_id": train.train_id,
                "scheduled_stops": [_stop_to_dict(stop) for stop in train.stops],
                "simulated_stops": [
                    _simulated_stop_to_dict(sim_stop) for sim_stop in results[train.train_id]
                ],
            }
            for train in trains
        ],
        "events": [_event_to_dict(event) for event in events],
    }
    return json.dumps(data, indent=2) + "\n"


def expected_stops(train: TrainSchedule) -> List[SimulatedStop]:
    """Compute arrival/departure times as if no per-stop delay had ever
    been applied, used as the baseline against which actual delay is
    measured."""
    undelayed_stops = [
        Stop(stop.station, stop.scheduled_departure, travel_time=stop.travel_time, delay=0)
        for stop in train.stops
    ]
    return simulate_train(TrainSchedule(train_id=train.train_id, stops=undelayed_stops))


def stop_delay_minutes(sim_stop: SimulatedStop, expected_stop: SimulatedStop) -> int:
    """The delay, in minutes, of a simulated stop relative to its
    undelayed baseline. Prefers departure time, falling back to arrival
    time for a route's final (arrival-only) stop."""
    if sim_stop.departure is not None and expected_stop.departure is not None:
        return sim_stop.departure - expected_stop.departure
    return sim_stop.arrival - expected_stop.arrival


def stop_status(delay_minutes: int) -> str:
    if delay_minutes <= 0:
        return "ON TIME"
    return f"DELAYED +{delay_minutes}m"


HTML_STYLE = """
    body { font-family: Arial, Helvetica, sans-serif; margin: 2rem; color: #1a1a1a; background: #fafafa; }
    h1 { margin-bottom: 0.25rem; }
    h2 { margin-top: 2rem; border-bottom: 2px solid #ccc; padding-bottom: 0.25rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }
    th { background: #eee; }
    tr.on-time td.status { color: #1a7f37; font-weight: bold; }
    tr.delayed td.status { color: #b3261e; font-weight: bold; }
""".strip("\n")


def _dashboard_stop_row(stop: Stop, sim_stop: SimulatedStop, expected_stop: SimulatedStop) -> str:
    delay_minutes = stop_delay_minutes(sim_stop, expected_stop)
    status = stop_status(delay_minutes)
    row_class = "on-time" if delay_minutes <= 0 else "delayed"

    scheduled = format_time(stop.scheduled_departure) if stop.scheduled_departure is not None else "-"
    arrival = format_time(sim_stop.arrival) if sim_stop.arrival is not None else "-"
    departure = format_time(sim_stop.departure) if sim_stop.departure is not None else "-"
    delay_text = f"+{delay_minutes}m" if delay_minutes > 0 else "0m"

    return (
        f'    <tr class="{row_class}">\n'
        f"      <td>{html.escape(stop.station)}</td>\n"
        f"      <td>{html.escape(scheduled)}</td>\n"
        f"      <td>{html.escape(arrival)}</td>\n"
        f"      <td>{html.escape(departure)}</td>\n"
        f"      <td>{html.escape(delay_text)}</td>\n"
        f'      <td class="status">{html.escape(status)}</td>\n'
        f"    </tr>"
    )


def _dashboard_train_section(train: TrainSchedule, results: Dict[str, List[SimulatedStop]]) -> str:
    sim_stops = results[train.train_id]
    baseline_stops = expected_stops(train)
    rows = "\n".join(
        _dashboard_stop_row(stop, sim_stop, expected_stop)
        for stop, sim_stop, expected_stop in zip(train.stops, sim_stops, baseline_stops)
    )
    return (
        f"  <h2>Train {html.escape(train.train_id)}</h2>\n"
        "  <table>\n"
        "    <thead>\n"
        "      <tr><th>Station</th><th>Scheduled</th><th>Arrival</th>"
        "<th>Departure</th><th>Delay</th><th>Status</th></tr>\n"
        "    </thead>\n"
        "    <tbody>\n"
        f"{rows}\n"
        "    </tbody>\n"
        "  </table>"
    )


def _dashboard_event_log_section(events: List[Event]) -> str:
    rows = "\n".join(
        "    <tr>\n"
        f"      <td>{html.escape(format_time(event.time))}</td>\n"
        f"      <td>{html.escape(event.train_id)}</td>\n"
        f"      <td>{html.escape(event.station)}</td>\n"
        f"      <td>{html.escape(event.kind)}</td>\n"
        "    </tr>"
        for event in events
    )
    return (
        "  <h2>Event Log</h2>\n"
        "  <table>\n"
        "    <thead>\n"
        "      <tr><th>Time</th><th>Train</th><th>Station</th><th>Event</th></tr>\n"
        "    </thead>\n"
        "    <tbody>\n"
        f"{rows}\n"
        "    </tbody>\n"
        "  </table>"
    )


def generate_dashboard_html(
    trains: List[TrainSchedule],
    results: Dict[str, List[SimulatedStop]],
    events: List[Event],
) -> str:
    """Render a dependency-free, self-contained static HTML dashboard
    summarizing stations, scheduled and actual times, delays, and status
    for every train, plus the deterministic event log. Uses only fixed
    inputs (no timestamps, randomness, or external resources), so the
    output is byte-identical across repeated calls."""
    train_sections = "\n\n".join(_dashboard_train_section(train, results) for train in trains)
    event_section = _dashboard_event_log_section(events)

    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '  <meta charset="utf-8">\n'
        "  <title>Train Dashboard</title>\n"
        "  <style>\n"
        f"{HTML_STYLE}\n"
        "  </style>\n"
        "</head>\n"
        "<body>\n"
        "  <h1>Train Dashboard</h1>\n"
        "  <p>Deterministic simulation summary of stations, scheduled and actual times, delays, and status.</p>\n"
        f"{train_sections}\n\n"
        f"{event_section}\n"
        "</body>\n"
        "</html>\n"
    )


def run(trains: List[TrainSchedule]) -> str:
    results = simulate_all(trains)
    events = build_events(trains, results)
    return "\n\n".join(
        [
            format_schedule_table(trains),
            format_simulation_table(trains, results),
            format_events(events),
        ]
    )


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic train schedule simulator")
    parser.add_argument(
        "--csv",
        metavar="PATH",
        help="Export the deterministic event log as CSV to PATH",
    )
    parser.add_argument(
        "--json",
        metavar="PATH",
        help="Export the full schedule, simulation, and event log as JSON to PATH",
    )
    parser.add_argument(
        "--html",
        metavar="PATH",
        help="Export a dependency-free static HTML dashboard to PATH",
    )
    args = parser.parse_args(argv)

    trains = demo_schedule()
    results = simulate_all(trains)
    events = build_events(trains, results)

    print(run(trains))

    if args.csv:
        with open(args.csv, "w", newline="") as handle:
            handle.write(export_events_csv(events))
        print(f"\nWrote CSV export to {args.csv}")

    if args.json:
        with open(args.json, "w") as handle:
            handle.write(export_schedule_json(trains, results, events))
        print(f"Wrote JSON export to {args.json}")

    if args.html:
        with open(args.html, "w") as handle:
            handle.write(generate_dashboard_html(trains, results, events))
        print(f"Wrote HTML dashboard to {args.html}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
