import subprocess
import sys
import unittest

from rocket_sim import RocketConfig, Stage, default_config, simulate


class DefaultConfigTests(unittest.TestCase):
    def test_default_config_succeeds(self):
        result = simulate(default_config())
        self.assertEqual(result.outcome, "SUCCESS")
        self.assertGreaterEqual(result.apogee_m, default_config().target_altitude_m)


class StageSeparationTests(unittest.TestCase):
    def test_lifts_off_and_separates_before_cutoff(self):
        config = RocketConfig(
            stage1=Stage(
                name="stage1",
                dry_mass_kg=2000.0,
                fuel_mass_kg=8000.0,
                thrust_n=250000.0,
                burn_rate_kg_s=800.0,
            ),
            stage2=Stage(
                name="stage2",
                dry_mass_kg=1000.0,
                fuel_mass_kg=3000.0,
                thrust_n=60000.0,
                burn_rate_kg_s=300.0,
            ),
            payload_mass_kg=500.0,
            target_altitude_m=5000.0,
            max_time_s=600.0,
        )

        result = simulate(config)

        liftoff_line = next(
            (l for l in result.telemetry_lines if "LIFTOFF" in l), None
        )
        separation_line = next(
            (l for l in result.telemetry_lines if "STAGE_SEPARATION" in l), None
        )

        self.assertIsNotNone(liftoff_line, "rocket never lifted off")
        self.assertIsNotNone(
            separation_line, "rocket never reached stage separation before cutoff"
        )
        self.assertLess(
            result.telemetry_lines.index(liftoff_line),
            result.telemetry_lines.index(separation_line),
        )
        self.assertIn("stage=2", separation_line)

        separation_index = result.telemetry_lines.index(separation_line)
        for line in result.telemetry_lines[separation_index:]:
            self.assertIn("stage=2", line)


class FailureOutcomeTests(unittest.TestCase):
    def test_insufficient_thrust_never_lifts_off(self):
        config = RocketConfig(
            stage1=Stage(
                name="stage1",
                dry_mass_kg=2000.0,
                fuel_mass_kg=8000.0,
                thrust_n=50000.0,
                burn_rate_kg_s=800.0,
            ),
            stage2=Stage(
                name="stage2",
                dry_mass_kg=1000.0,
                fuel_mass_kg=3000.0,
                thrust_n=60000.0,
                burn_rate_kg_s=300.0,
            ),
            payload_mass_kg=500.0,
            target_altitude_m=5000.0,
            max_time_s=600.0,
        )

        result = simulate(config)

        self.assertEqual(result.outcome, "FAILURE")
        self.assertEqual(result.reason, "INSUFFICIENT_THRUST")
        self.assertEqual(result.apogee_m, 0.0)

    def test_fuel_depletes_short_of_target(self):
        config = RocketConfig(
            stage1=Stage(
                name="stage1",
                dry_mass_kg=2000.0,
                fuel_mass_kg=8000.0,
                thrust_n=250000.0,
                burn_rate_kg_s=800.0,
            ),
            stage2=Stage(
                name="stage2",
                dry_mass_kg=1000.0,
                fuel_mass_kg=3000.0,
                thrust_n=60000.0,
                burn_rate_kg_s=300.0,
            ),
            payload_mass_kg=500.0,
            target_altitude_m=1000000.0,
            max_time_s=600.0,
        )

        result = simulate(config)

        self.assertEqual(result.outcome, "FAILURE")
        self.assertEqual(result.reason, "TARGET_ALTITUDE_NOT_REACHED")
        self.assertLess(result.apogee_m, config.target_altitude_m)

    def test_timeout_cutoff_triggers_failure(self):
        config = RocketConfig(
            stage1=Stage(
                name="stage1",
                dry_mass_kg=2000.0,
                fuel_mass_kg=8000.0,
                thrust_n=250000.0,
                burn_rate_kg_s=800.0,
            ),
            stage2=Stage(
                name="stage2",
                dry_mass_kg=1000.0,
                fuel_mass_kg=3000.0,
                thrust_n=60000.0,
                burn_rate_kg_s=300.0,
            ),
            payload_mass_kg=500.0,
            target_altitude_m=5000.0,
            max_time_s=15.0,
        )

        result = simulate(config)

        self.assertEqual(result.outcome, "FAILURE")
        self.assertEqual(result.reason, "TIMEOUT")


class CliDeterminismTests(unittest.TestCase):
    def test_two_runs_are_byte_identical(self):
        run1 = subprocess.run(
            [sys.executable, "rocket_sim.py"], capture_output=True, check=True
        )
        run2 = subprocess.run(
            [sys.executable, "rocket_sim.py"], capture_output=True, check=True
        )
        self.assertEqual(run1.stdout, run2.stdout)
        self.assertGreater(len(run1.stdout), 0)


if __name__ == "__main__":
    unittest.main()
