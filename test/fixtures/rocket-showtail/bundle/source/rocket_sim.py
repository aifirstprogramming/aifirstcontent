#!/usr/bin/env python3
"""Deterministic, GUI-less two-stage rocket launch simulation."""

from dataclasses import dataclass, field

GRAVITY_M_S2 = 9.81
DT_S = 0.1
PRINT_INTERVAL_S = 1.0


@dataclass(frozen=True)
class Stage:
    name: str
    dry_mass_kg: float
    fuel_mass_kg: float
    thrust_n: float
    burn_rate_kg_s: float


@dataclass(frozen=True)
class RocketConfig:
    stage1: Stage
    stage2: Stage
    payload_mass_kg: float
    target_altitude_m: float
    max_time_s: float


@dataclass
class SimResult:
    telemetry_lines: list = field(default_factory=list)
    outcome: str = ""
    reason: str = ""
    apogee_m: float = 0.0


def _clean(value: float) -> float:
    """Collapse -0.0 and float noise so formatting is deterministic."""
    if abs(value) < 1e-9:
        return 0.0
    return value


def _format_line(t, stage, fuel, vel, alt, event):
    return (
        f"t={t:7.2f}s stage={stage:1d} fuel={fuel:9.2f}kg "
        f"vel={vel:9.2f}m/s alt={alt:11.2f}m event={event}"
    )


def default_config() -> RocketConfig:
    stage1 = Stage(
        name="stage1",
        dry_mass_kg=2000.0,
        fuel_mass_kg=8000.0,
        thrust_n=250000.0,
        burn_rate_kg_s=800.0,
    )
    stage2 = Stage(
        name="stage2",
        dry_mass_kg=1000.0,
        fuel_mass_kg=3000.0,
        thrust_n=60000.0,
        burn_rate_kg_s=300.0,
    )
    return RocketConfig(
        stage1=stage1,
        stage2=stage2,
        payload_mass_kg=500.0,
        target_altitude_m=5000.0,
        max_time_s=600.0,
    )


def simulate(config: RocketConfig) -> SimResult:
    result = SimResult()

    stage1_fuel = config.stage1.fuel_mass_kg
    stage2_fuel = config.stage2.fuel_mass_kg
    stage1_attached = True
    active_stage = 1

    t = 0.0
    altitude = 0.0
    velocity = 0.0
    apogee = 0.0

    has_lifted_off = False
    has_separated = False
    has_reached_apogee = False
    prev_velocity = 0.0

    tick = 0
    while True:
        mass = config.payload_mass_kg + config.stage2.dry_mass_kg + stage2_fuel
        if stage1_attached:
            mass += config.stage1.dry_mass_kg + stage1_fuel

        if active_stage == 1 and stage1_fuel > 0:
            thrust = config.stage1.thrust_n
        elif active_stage == 2 and stage2_fuel > 0:
            thrust = config.stage2.thrust_n
        else:
            thrust = 0.0

        acceleration = thrust / mass - GRAVITY_M_S2

        events = []

        if not has_lifted_off and altitude > 0.0:
            has_lifted_off = True
            events.append("LIFTOFF")

        if active_stage == 1 and stage1_fuel <= 0.0 and not has_separated:
            has_separated = True
            stage1_attached = False
            active_stage = 2
            events.append("STAGE_SEPARATION")

        if (
            has_lifted_off
            and not has_reached_apogee
            and prev_velocity > 0.0
            and velocity <= 0.0
        ):
            has_reached_apogee = True
            events.append("APOGEE")

        landed = has_lifted_off and altitude <= 0.0 and tick > 0
        if landed:
            events.append("LANDING")

        timed_out = t >= config.max_time_s

        should_print = (
            tick % round(PRINT_INTERVAL_S / DT_S) == 0
            or events
            or landed
            or timed_out
        )
        if should_print:
            event_label = "|".join(events) if events else "-"
            result.telemetry_lines.append(
                _format_line(
                    _clean(t),
                    active_stage,
                    _clean(stage1_fuel if active_stage == 1 else stage2_fuel),
                    _clean(velocity),
                    _clean(altitude),
                    event_label,
                )
            )

        apogee = max(apogee, altitude)

        if landed:
            break
        if timed_out:
            break

        prev_velocity = velocity
        velocity += acceleration * DT_S
        altitude += velocity * DT_S
        if active_stage == 1 and stage1_fuel > 0:
            stage1_fuel = max(0.0, stage1_fuel - config.stage1.burn_rate_kg_s * DT_S)
        elif active_stage == 2 and stage2_fuel > 0:
            stage2_fuel = max(0.0, stage2_fuel - config.stage2.burn_rate_kg_s * DT_S)

        t += DT_S
        tick += 1

    result.apogee_m = _clean(apogee)

    if not has_lifted_off:
        result.outcome = "FAILURE"
        result.reason = "INSUFFICIENT_THRUST"
    elif timed_out and not landed:
        result.outcome = "FAILURE"
        result.reason = "TIMEOUT"
    elif apogee >= config.target_altitude_m:
        result.outcome = "SUCCESS"
        result.reason = "TARGET_ALTITUDE_REACHED"
    else:
        result.outcome = "FAILURE"
        result.reason = "TARGET_ALTITUDE_NOT_REACHED"

    return result


def main() -> None:
    config = default_config()
    result = simulate(config)
    for line in result.telemetry_lines:
        print(line)
    print(
        f"OUTCOME: {result.outcome} reason={result.reason} "
        f"apogee={result.apogee_m:.2f}m target={config.target_altitude_m:.2f}m"
    )


if __name__ == "__main__":
    main()
