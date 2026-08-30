import csv
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

import train_sim as ts


class TestTimeHelpers(unittest.TestCase):
    def test_parse_time(self):
        self.assertEqual(ts.parse_time("08:05"), 8 * 60 + 5)
        self.assertEqual(ts.parse_time("00:00"), 0)
        self.assertEqual(ts.parse_time("23:59"), 23 * 60 + 59)

    def test_parse_time_invalid(self):
        with self.assertRaises(ValueError):
            ts.parse_time("8:5:3")
        with self.assertRaises(ValueError):
            ts.parse_time("08:75")

    def test_format_time_same_day(self):
        self.assertEqual(ts.format_time(0), "00:00")
        self.assertEqual(ts.format_time(65), "01:05")

    def test_format_time_next_day(self):
        self.assertEqual(ts.format_time(1440), "00:00+1d")
        self.assertEqual(ts.format_time(1440 + 90), "01:30+1d")

    def test_roundtrip(self):
        for text in ["00:00", "07:30", "23:59"]:
            self.assertEqual(ts.format_time(ts.parse_time(text)), text)


class TestTrainScheduleValidation(unittest.TestCase):
    def test_requires_at_least_one_stop(self):
        with self.assertRaises(ValueError):
            ts.TrainSchedule(train_id="X1", stops=[])

    def test_first_stop_must_have_departure(self):
        with self.assertRaises(ValueError):
            ts.TrainSchedule(
                train_id="X1",
                stops=[ts.Stop("A", None), ts.Stop("B", None)],
            )

    def test_intermediate_stop_must_have_departure(self):
        with self.assertRaises(ValueError):
            ts.TrainSchedule(
                train_id="X1",
                stops=[
                    ts.Stop("A", ts.parse_time("08:00"), travel_time=10),
                    ts.Stop("B", None, travel_time=10),
                    ts.Stop("C", None),
                ],
            )


class TestSimulateTrain(unittest.TestCase):
    def test_no_delay(self):
        train = ts.TrainSchedule(
            train_id="T1",
            stops=[
                ts.Stop("A", ts.parse_time("08:00"), travel_time=10),
                ts.Stop("B", ts.parse_time("08:10"), travel_time=15),
                ts.Stop("C", None),
            ],
        )
        result = ts.simulate_train(train)
        self.assertEqual(
            result,
            [
                ts.SimulatedStop("A", arrival=None, departure=ts.parse_time("08:00")),
                ts.SimulatedStop("B", arrival=ts.parse_time("08:10"), departure=ts.parse_time("08:10")),
                ts.SimulatedStop("C", arrival=ts.parse_time("08:25"), departure=None),
            ],
        )

    def test_delay_propagates_forward(self):
        train = ts.TrainSchedule(
            train_id="T2",
            stops=[
                ts.Stop("A", ts.parse_time("08:00"), travel_time=10, delay=5),
                ts.Stop("B", ts.parse_time("08:10"), travel_time=15),
                ts.Stop("C", None),
            ],
        )
        result = ts.simulate_train(train)
        # First stop departs 5 min late -> 08:05
        self.assertEqual(result[0].departure, ts.parse_time("08:05"))
        # Arrival at B is 10 min after actual departure from A, not scheduled
        self.assertEqual(result[1].arrival, ts.parse_time("08:15"))
        # B has no extra delay, so it departs as soon as it arrives
        self.assertEqual(result[1].departure, ts.parse_time("08:15"))
        # Arrival at C reflects the delay carried the whole way
        self.assertEqual(result[2].arrival, ts.parse_time("08:30"))
        self.assertIsNone(result[2].departure)

    def test_delay_at_intermediate_stop(self):
        train = ts.TrainSchedule(
            train_id="T3",
            stops=[
                ts.Stop("A", ts.parse_time("08:00"), travel_time=10),
                ts.Stop("B", ts.parse_time("08:10"), travel_time=15, delay=20),
                ts.Stop("C", None),
            ],
        )
        result = ts.simulate_train(train)
        self.assertEqual(result[1].arrival, ts.parse_time("08:10"))
        self.assertEqual(result[1].departure, ts.parse_time("08:30"))
        self.assertEqual(result[2].arrival, ts.parse_time("08:45"))

    def test_deterministic_repeated_runs(self):
        train = ts.TrainSchedule(
            train_id="T4",
            stops=[
                ts.Stop("A", ts.parse_time("09:00"), travel_time=5, delay=3),
                ts.Stop("B", None),
            ],
        )
        first = ts.simulate_train(train)
        second = ts.simulate_train(train)
        self.assertEqual(first, second)


class TestBuildEvents(unittest.TestCase):
    def test_events_sorted_by_time_then_train_then_seq(self):
        trains = [
            ts.TrainSchedule(
                train_id="B",
                stops=[
                    ts.Stop("Station1", ts.parse_time("08:00"), travel_time=10),
                    ts.Stop("Station2", None),
                ],
            ),
            ts.TrainSchedule(
                train_id="A",
                stops=[
                    ts.Stop("Station1", ts.parse_time("08:00"), travel_time=10),
                    ts.Stop("Station2", None),
                ],
            ),
        ]
        results = ts.simulate_all(trains)
        events = ts.build_events(trains, results)

        times = [event.time for event in events]
        self.assertEqual(times, sorted(times))

        same_time_departures = [e for e in events if e.time == ts.parse_time("08:00")]
        self.assertEqual([e.train_id for e in same_time_departures], ["A", "B"])

    def test_arrival_before_departure_at_same_time(self):
        # A train that departs immediately upon arrival (no delay) produces
        # an arrival event and a departure event at the identical timestamp;
        # arrival must always be ordered first.
        train = ts.TrainSchedule(
            train_id="T5",
            stops=[
                ts.Stop("A", ts.parse_time("08:00"), travel_time=10),
                ts.Stop("B", ts.parse_time("08:10"), travel_time=5),
                ts.Stop("C", None),
            ],
        )
        results = ts.simulate_all([train])
        events = ts.build_events([train], results)
        same_time = [e for e in events if e.time == ts.parse_time("08:10")]
        self.assertEqual([e.kind for e in same_time], ["arrival", "departure"])

    def test_events_are_deterministic_across_runs(self):
        trains = ts.demo_schedule()
        results = ts.simulate_all(trains)
        events_a = ts.build_events(trains, results)
        events_b = ts.build_events(trains, ts.simulate_all(trains))
        self.assertEqual(events_a, events_b)


class TestFormatting(unittest.TestCase):
    def setUp(self):
        self.trains = ts.demo_schedule()
        self.results = ts.simulate_all(self.trains)

    def test_schedule_table_contains_stations_and_delays(self):
        table = ts.format_schedule_table(self.trains)
        self.assertIn("Train R101", table)
        self.assertIn("Central", table)
        self.assertIn("delay +5m", table)

    def test_simulation_table_contains_arrival_and_departure(self):
        table = ts.format_simulation_table(self.trains, self.results)
        self.assertIn("arr", table)
        self.assertIn("dep", table)

    def test_event_log_contains_all_trains(self):
        events = ts.build_events(self.trains, self.results)
        log = ts.format_events(events)
        self.assertIn("R101", log)
        self.assertIn("R202", log)


class TestCLI(unittest.TestCase):
    def test_main_prints_readable_output_and_is_deterministic(self):
        buffer1 = io.StringIO()
        with redirect_stdout(buffer1):
            exit_code = ts.main([])
        self.assertEqual(exit_code, 0)

        buffer2 = io.StringIO()
        with redirect_stdout(buffer2):
            ts.main([])

        output1 = buffer1.getvalue()
        output2 = buffer2.getvalue()
        self.assertEqual(output1, output2)
        self.assertIn("Scheduled timetable:", output1)
        self.assertIn("Simulated timetable:", output1)
        self.assertIn("Event log:", output1)

    def test_main_writes_csv_and_json_exports(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = os.path.join(tmpdir, "events.csv")
            json_path = os.path.join(tmpdir, "schedule.json")

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                exit_code = ts.main(["--csv", csv_path, "--json", json_path])

            self.assertEqual(exit_code, 0)
            self.assertIn(f"Wrote CSV export to {csv_path}", buffer.getvalue())
            self.assertIn(f"Wrote JSON export to {json_path}", buffer.getvalue())
            self.assertTrue(os.path.isfile(csv_path))
            self.assertTrue(os.path.isfile(json_path))

            with open(csv_path, newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertGreater(len(rows), 0)
            self.assertEqual(set(rows[0].keys()), set(ts.CSV_FIELDNAMES))

            with open(json_path) as handle:
                data = json.load(handle)
            self.assertIn("trains", data)
            self.assertIn("events", data)
            train_ids = [train["train_id"] for train in data["trains"]]
            self.assertEqual(train_ids, ["R101", "R202"])


class TestCsvExport(unittest.TestCase):
    def setUp(self):
        self.trains = ts.demo_schedule()
        self.results = ts.simulate_all(self.trains)
        self.events = ts.build_events(self.trains, self.results)

    def test_csv_header_and_row_count(self):
        text = ts.export_events_csv(self.events)
        rows = list(csv.reader(io.StringIO(text)))
        self.assertEqual(rows[0], ts.CSV_FIELDNAMES)
        self.assertEqual(len(rows) - 1, len(self.events))

    def test_csv_rows_match_events_in_order(self):
        text = ts.export_events_csv(self.events)
        rows = list(csv.DictReader(io.StringIO(text)))
        for row, event in zip(rows, self.events):
            self.assertEqual(int(row["time_minutes"]), event.time)
            self.assertEqual(row["time"], ts.format_time(event.time))
            self.assertEqual(row["train_id"], event.train_id)
            self.assertEqual(row["station"], event.station)
            self.assertEqual(row["kind"], event.kind)

    def test_csv_export_is_deterministic(self):
        first = ts.export_events_csv(self.events)
        second = ts.export_events_csv(ts.build_events(self.trains, ts.simulate_all(self.trains)))
        self.assertEqual(first, second)

    def test_csv_empty_events_still_has_header(self):
        text = ts.export_events_csv([])
        rows = list(csv.reader(io.StringIO(text)))
        self.assertEqual(rows, [ts.CSV_FIELDNAMES])


class TestJsonExport(unittest.TestCase):
    def setUp(self):
        self.trains = ts.demo_schedule()
        self.results = ts.simulate_all(self.trains)
        self.events = ts.build_events(self.trains, self.results)

    def test_json_is_valid_and_well_structured(self):
        text = ts.export_schedule_json(self.trains, self.results, self.events)
        data = json.loads(text)

        self.assertEqual(len(data["trains"]), len(self.trains))
        for train, train_data in zip(self.trains, data["trains"]):
            self.assertEqual(train_data["train_id"], train.train_id)
            self.assertEqual(len(train_data["scheduled_stops"]), len(train.stops))
            self.assertEqual(len(train_data["simulated_stops"]), len(train.stops))

        self.assertEqual(len(data["events"]), len(self.events))
        for event_data, event in zip(data["events"], self.events):
            self.assertEqual(event_data["time"], event.time)
            self.assertEqual(event_data["time_formatted"], ts.format_time(event.time))
            self.assertEqual(event_data["train_id"], event.train_id)
            self.assertEqual(event_data["station"], event.station)
            self.assertEqual(event_data["kind"], event.kind)

    def test_json_scheduled_stop_fields(self):
        text = ts.export_schedule_json(self.trains, self.results, self.events)
        data = json.loads(text)
        first_train_stop = data["trains"][0]["scheduled_stops"][0]
        self.assertEqual(first_train_stop["station"], "Central")
        self.assertEqual(first_train_stop["scheduled_departure"], ts.parse_time("08:00"))
        self.assertEqual(first_train_stop["scheduled_departure_formatted"], "08:00")

        last_train_stop = data["trains"][0]["scheduled_stops"][-1]
        self.assertIsNone(last_train_stop["scheduled_departure"])
        self.assertIsNone(last_train_stop["scheduled_departure_formatted"])

    def test_json_simulated_stop_fields(self):
        text = ts.export_schedule_json(self.trains, self.results, self.events)
        data = json.loads(text)
        first_stop = data["trains"][0]["simulated_stops"][0]
        self.assertIsNone(first_stop["arrival"])
        self.assertIsNone(first_stop["arrival_formatted"])
        self.assertIsNotNone(first_stop["departure"])

    def test_json_export_is_deterministic(self):
        first = ts.export_schedule_json(self.trains, self.results, self.events)
        results2 = ts.simulate_all(self.trains)
        events2 = ts.build_events(self.trains, results2)
        second = ts.export_schedule_json(self.trains, results2, events2)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
