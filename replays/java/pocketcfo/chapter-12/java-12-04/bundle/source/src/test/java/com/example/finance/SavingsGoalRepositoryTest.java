package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SavingsGoalRepositoryTest {

    @Test
    void updateReplacesTheMatchingGoal(@TempDir Path tempDir) {
        SavingsGoalRepository repository = new SavingsGoalRepository(new DataPaths(tempDir));
        repository.add(new SavingsGoal("Vacation", new BigDecimal("2000.00"), null, "Travel"));

        repository.update("Vacation", new SavingsGoal("Big trip", new BigDecimal("2500.00"), null, "Travel"));

        List<SavingsGoal> goals = repository.findAll();
        assertEquals(1, goals.size());
        assertEquals("Big trip", goals.get(0).getName());
        assertEquals(new BigDecimal("2500.00"), goals.get(0).getTargetAmount());
    }

    @Test
    void removeDeletesTheMatchingGoal(@TempDir Path tempDir) {
        SavingsGoalRepository repository = new SavingsGoalRepository(new DataPaths(tempDir));
        repository.add(new SavingsGoal("Vacation", new BigDecimal("2000.00"), null, "Travel"));
        repository.add(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Savings"));

        repository.remove("Vacation");

        List<SavingsGoal> goals = repository.findAll();
        assertEquals(1, goals.size());
        assertEquals("Emergency fund", goals.get(0).getName());
    }

    @Test
    void loadsCurrentFormatLinesThatIncludeTheCategoryNameColumn(@TempDir Path tempDir) throws Exception {
        DataPaths dataPaths = new DataPaths(tempDir);
        Files.createDirectories(tempDir);
        Files.writeString(dataPaths.savingsGoalsFile(), String.join("\n",
                "# name|targetAmount|targetDate|categoryName",
                "Vacation|2000.00||Travel") + "\n");

        SavingsGoalRepository repository = new SavingsGoalRepository(dataPaths);
        List<SavingsGoal> goals = repository.findAll();

        assertEquals(1, goals.size());
        assertEquals("Vacation", goals.get(0).getName());
        assertEquals("Travel", goals.get(0).getCategoryName());
    }

    @Test
    void loadsLegacyLinesWithoutACategoryColumnDefaultingCategoryNameToTheGoalsOwnName(
            @TempDir Path tempDir) throws Exception {
        DataPaths dataPaths = new DataPaths(tempDir);
        Files.createDirectories(tempDir);
        Files.writeString(dataPaths.savingsGoalsFile(), String.join("\n",
                "# name|targetAmount|targetDate",
                "Vacation|2000.00|") + "\n");

        SavingsGoalRepository repository = new SavingsGoalRepository(dataPaths);
        List<SavingsGoal> goals = repository.findAll();

        assertEquals(1, goals.size());
        assertEquals("Vacation", goals.get(0).getCategoryName());
    }

    @Test
    void renameCategoryUpdatesGoalsPointingAtTheOldCategoryName(@TempDir Path tempDir) {
        SavingsGoalRepository repository = new SavingsGoalRepository(new DataPaths(tempDir));
        repository.add(new SavingsGoal("Vacation", new BigDecimal("2000.00"), null, "Travel"));

        repository.renameCategory("Travel", "Trips");

        assertEquals("Trips", repository.findAll().get(0).getCategoryName());
    }
}
