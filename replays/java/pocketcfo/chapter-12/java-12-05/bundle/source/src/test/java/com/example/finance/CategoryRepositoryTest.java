package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CategoryRepositoryTest {

    @Test
    void addPersistsAndReloadsThePriorityColumn(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository repository = new CategoryRepository(dataPaths);
        repository.add(new Category("Rent", new BigDecimal("800.00"), 1));

        CategoryRepository reloaded = new CategoryRepository(dataPaths);
        List<Category> categories = reloaded.findAll();

        assertEquals(1, categories.size());
        assertEquals(1, categories.get(0).getPriority().orElseThrow());
    }

    @Test
    void updateReplacesTheMatchingCategoryIncludingPriority(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository repository = new CategoryRepository(dataPaths);
        repository.add(new Category("Streaming", new BigDecimal("15.00"), 3));

        repository.update("Streaming", new Category("Streaming", new BigDecimal("15.00"), 2));

        CategoryRepository reloaded = new CategoryRepository(dataPaths);
        assertEquals(2, reloaded.findAll().get(0).getPriority().orElseThrow());
    }

    @Test
    void loadsOlderLinesThatStillHaveOnlyNameAndMonthlyTargetColumns(@TempDir Path tempDir) throws Exception {
        DataPaths dataPaths = new DataPaths(tempDir);
        Files.createDirectories(tempDir);
        Files.writeString(dataPaths.categoriesFile(), String.join("\n",
                "# name|monthlyTarget",
                "Groceries|400.00") + "\n");

        CategoryRepository repository = new CategoryRepository(dataPaths);
        List<Category> categories = repository.findAll();

        assertEquals(1, categories.size());
        assertEquals(new BigDecimal("400.00"), categories.get(0).getMonthlyTarget());
        assertTrue(categories.get(0).getPriority().isEmpty());
    }

    @Test
    void loadsLinesWithABlankPriorityColumnAsUnprioritized(@TempDir Path tempDir) throws Exception {
        DataPaths dataPaths = new DataPaths(tempDir);
        Files.createDirectories(tempDir);
        Files.writeString(dataPaths.categoriesFile(), String.join("\n",
                "# name|monthlyTarget|priority",
                "Groceries|400.00|") + "\n");

        CategoryRepository repository = new CategoryRepository(dataPaths);
        List<Category> categories = repository.findAll();

        assertEquals(1, categories.size());
        assertTrue(categories.get(0).getPriority().isEmpty());
    }

    @Test
    void skipsLinesWithAnInvalidPriorityValueConsistentWithOtherMalformedLines(@TempDir Path tempDir) throws Exception {
        DataPaths dataPaths = new DataPaths(tempDir);
        Files.createDirectories(tempDir);
        Files.writeString(dataPaths.categoriesFile(), String.join("\n",
                "# name|monthlyTarget|priority",
                "Groceries|400.00|NOT_A_NUMBER") + "\n");

        CategoryRepository repository = new CategoryRepository(dataPaths);

        assertTrue(repository.findAll().isEmpty());
    }
}
