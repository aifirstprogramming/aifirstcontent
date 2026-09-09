package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CategoryServiceTest {

    private record Fixture(CategoryService service, CategoryRepository categoryRepository,
                            TransactionRepository transactionRepository,
                            RecurringObligationRepository recurringObligationRepository,
                            SavingsGoalRepository savingsGoalRepository) {
    }

    private Fixture newFixture(Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        CategoryService service = new CategoryService(
                categoryRepository, transactionRepository, recurringObligationRepository, savingsGoalRepository);
        return new Fixture(service, categoryRepository, transactionRepository, recurringObligationRepository,
                savingsGoalRepository);
    }

    @Test
    void updateRenamesCategoryAndCascadesToTransactions(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Groceries", new BigDecimal("400.00")));
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("50.00"), "shop");

        fixture.service().update("Groceries", new Category("Food", new BigDecimal("450.00")));

        assertEquals("Food", fixture.categoryRepository().findAll().get(0).getName());
        assertTrue(fixture.transactionRepository().findAll().stream()
                .allMatch(t -> t.getCategoryName().equals("Food")));
    }

    @Test
    void deleteRemovesAnUnusedCategory(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Groceries", new BigDecimal("400.00")));

        fixture.service().delete("Groceries");

        assertEquals(0, fixture.categoryRepository().findAll().size());
    }

    @Test
    void deleteRejectsACategoryStillUsedByATransaction(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Groceries", new BigDecimal("400.00")));
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("50.00"), "shop");

        assertThrows(IllegalStateException.class, () -> fixture.service().delete("Groceries"));
        assertEquals(1, fixture.categoryRepository().findAll().size());
    }

    @Test
    void deleteRejectsACategoryStillUsedByAnObligation(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Meal kit", BigDecimal.ZERO));
        fixture.recurringObligationRepository().add(new RecurringObligation("Weekly delivery", "Meal kit",
                new BigDecimal("60.00"), 1, LocalDate.of(2026, 1, 1), null, null));

        assertThrows(IllegalStateException.class, () -> fixture.service().delete("Meal kit"));
    }

    @Test
    void deleteRejectsACategoryStillUsedByASavingsGoal(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.savingsGoalRepository().add(
                new SavingsGoal("Rainy day", new BigDecimal("1000.00"), null, "Emergency fund"));

        assertThrows(IllegalStateException.class, () -> fixture.service().delete("Emergency fund"));
    }

    @Test
    void updateRenameCascadesToAnObligationsAssignedCategory(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Groceries", new BigDecimal("400.00")));
        fixture.recurringObligationRepository().add(new RecurringObligation("Weekly delivery", "Groceries",
                new BigDecimal("60.00"), 1, LocalDate.of(2026, 1, 1), null, null));

        fixture.service().update("Groceries", new Category("Food", new BigDecimal("450.00")));

        assertEquals("Food", fixture.recurringObligationRepository().findAll().get(0).getCategoryName());
    }

    @Test
    void updateRenameCascadesToASavingsGoalsAssignedCategory(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.savingsGoalRepository().add(
                new SavingsGoal("Rainy day", new BigDecimal("1000.00"), null, "Emergency fund"));

        fixture.service().update("Emergency fund", new Category("Safety net", BigDecimal.ZERO));

        assertEquals("Safety net", fixture.savingsGoalRepository().findAll().get(0).getCategoryName());
    }
}
