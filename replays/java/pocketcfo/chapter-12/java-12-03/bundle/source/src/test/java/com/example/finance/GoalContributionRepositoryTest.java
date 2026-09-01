package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class GoalContributionRepositoryTest {

    @Test
    void updateReplacesTheMatchingContribution(@TempDir Path tempDir) {
        GoalContributionRepository repository = new GoalContributionRepository(new DataPaths(tempDir));
        GoalContribution contribution = repository.add(LocalDate.of(2026, 8, 5), "Emergency fund",
                new BigDecimal("100.00"));

        repository.update(contribution.getId(), LocalDate.of(2026, 8, 6), "Vacation", new BigDecimal("150.00"));

        List<GoalContribution> contributions = repository.findAll();
        assertEquals(1, contributions.size());
        assertEquals("Vacation", contributions.get(0).getGoalName());
        assertEquals(new BigDecimal("150.00"), contributions.get(0).getAmount());
    }

    @Test
    void removeDeletesTheMatchingContribution(@TempDir Path tempDir) {
        GoalContributionRepository repository = new GoalContributionRepository(new DataPaths(tempDir));
        GoalContribution first = repository.add(LocalDate.of(2026, 8, 5), "Emergency fund", new BigDecimal("100.00"));
        repository.add(LocalDate.of(2026, 8, 6), "Vacation", new BigDecimal("50.00"));

        repository.remove(first.getId());

        List<GoalContribution> contributions = repository.findAll();
        assertEquals(1, contributions.size());
        assertEquals("Vacation", contributions.get(0).getGoalName());
    }

    @Test
    void loadsOlderLinesThatPredateTheIdColumn(@TempDir Path tempDir) throws Exception {
        DataPaths dataPaths = new DataPaths(tempDir);
        Files.createDirectories(tempDir);
        Files.writeString(dataPaths.goalContributionsFile(), String.join("\n",
                "# date|goalName|amount",
                "2026-08-14|Vacation|20.00",
                "2026-08-14|Celebration|50.00") + "\n");

        GoalContributionRepository repository = new GoalContributionRepository(dataPaths);
        List<GoalContribution> contributions = repository.findAll();

        assertEquals(2, contributions.size());
        assertEquals("Vacation", contributions.get(0).getGoalName());
        assertEquals("Celebration", contributions.get(1).getGoalName());
        assertEquals(1, contributions.get(0).getId());
        assertEquals(2, contributions.get(1).getId());

        // A newly added contribution must not collide with the ids just assigned above.
        GoalContribution added = repository.add(LocalDate.of(2026, 8, 15), "Vacation", new BigDecimal("10.00"));
        assertEquals(3, added.getId());
    }
}
