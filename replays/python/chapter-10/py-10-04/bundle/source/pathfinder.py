"""Grid pathfinding used by the level editor to check level beatability.

Pure logic, no pygame dependency, so it can be tested independently of a
display. Beatability means: is there a path through non-obstacle cells
connecting the player start, every sibling, and mother? Fox patrols are
intentionally ignored -- getting caught only resets the player to the start
(see main.py), it never permanently blocks a path.
"""

from collections import deque


def neighbors(cell, cols, rows):
    col, row = cell
    for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nc, nr = col + dc, row + dr
        if 0 <= nc < cols and 0 <= nr < rows:
            yield (nc, nr)


def flood_fill(start, blocked, cols, rows):
    """BFS from start over all free cells.

    Returns (visited_order, came_from): visited_order is the cell visitation
    order (drives the frontier animation), came_from maps cell -> predecessor
    (start -> None), enabling path reconstruction to any reached cell without
    re-searching.
    """
    frontier = deque([start])
    came_from = {start: None}
    visited_order = [start]
    while frontier:
        current = frontier.popleft()
        for nxt in neighbors(current, cols, rows):
            if nxt in came_from or nxt in blocked:
                continue
            came_from[nxt] = current
            visited_order.append(nxt)
            frontier.append(nxt)
    return visited_order, came_from


def reconstruct_path(came_from, goal):
    path = [goal]
    while came_from[path[-1]] is not None:
        path.append(came_from[path[-1]])
    path.reverse()
    return path


def find_route(start, targets, blocked, cols, rows):
    """Greedily visit `targets` nearest-first from `start`.

    Returns (legs, beatable, unreachable_target). Each leg is a dict:
    {"visited_order": [...], "path": [...] or None, "goal": cell}.
    Stops at the first leg where nothing remaining is reachable.
    """
    remaining = set(targets)
    current = start
    legs = []
    while remaining:
        visited_order, came_from = flood_fill(current, blocked, cols, rows)
        reached = [c for c in visited_order if c in remaining]
        if not reached:
            legs.append({
                "visited_order": visited_order,
                "path": None,
                "goal": next(iter(remaining)),
            })
            return legs, False, next(iter(remaining))

        goal = reached[0]  # first-reached among remaining == nearest by BFS distance
        legs.append({
            "visited_order": visited_order,
            "path": reconstruct_path(came_from, goal),
            "goal": goal,
        })
        remaining.discard(goal)
        current = goal

    return legs, True, None
