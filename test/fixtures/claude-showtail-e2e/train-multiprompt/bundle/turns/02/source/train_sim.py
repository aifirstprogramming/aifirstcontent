"""Deterministic train schedule simulator.

Models stations, scheduled departures, travel times between stops, and
per-stop delays. Given a set of train schedules, computes actual arrival
and departure times at every stop and a deterministically ordered stream
of arrival/departure events.
"""

from __future__ import annotations

import argparse
import csv
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

    return 0


if __name__ == "__main__":
    sys.exit(main())
