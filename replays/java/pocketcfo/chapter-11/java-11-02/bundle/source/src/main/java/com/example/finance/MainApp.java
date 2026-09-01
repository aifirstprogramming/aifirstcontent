package com.example.finance;

import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.control.TabPane;
import javafx.stage.Stage;

public class MainApp extends Application {

    @Override
    public void start(Stage stage) {
        DataPaths dataPaths = new DataPaths();
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        CategoryService categoryService = new CategoryService(
                categoryRepository, transactionRepository, recurringObligationRepository, savingsGoalRepository);
        RecurringObligationService recurringObligationService = new RecurringObligationService(
                recurringObligationRepository, transactionRepository, categoryRepository, categoryService);
        BudgetService budgetService = new BudgetService(categoryRepository, transactionRepository);
        SavingsGoalService savingsGoalService = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService, categoryRepository, categoryService);
        MonthSummaryService monthSummaryService = new MonthSummaryService(
                budgetService, savingsGoalService, recurringObligationService);

        MonthSummaryView monthSummaryView = new MonthSummaryView(monthSummaryService);
        TransactionEntryView transactionEntryView = new TransactionEntryView(categoryRepository, transactionRepository);
        CategorySummaryView categorySummaryView = new CategorySummaryView(
                categoryRepository, categoryService, budgetService);
        SavingsGoalsView savingsGoalsView = new SavingsGoalsView(
                savingsGoalRepository, goalContributionRepository, savingsGoalService);
        RecurringObligationsView recurringObligationsView = new RecurringObligationsView(
                recurringObligationRepository, recurringObligationService);

        TabPane tabPane = new TabPane();
        tabPane.getTabs().addAll(
                monthSummaryView.asTab(),
                transactionEntryView.asTab(),
                categorySummaryView.asTab(),
                savingsGoalsView.asTab(),
                recurringObligationsView.asTab());

        // Entering any tab re-pulls the latest data, since transactions/goals/
        // obligations/categories entered in one tab feed the totals shown in the others.
        tabPane.getSelectionModel().selectedItemProperty().addListener((obs, oldTab, newTab) -> {
            transactionEntryView.refresh();
            categorySummaryView.refresh();
            savingsGoalsView.refresh();
            recurringObligationsView.refresh();
            monthSummaryView.refresh();
        });

        stage.setTitle("Personal Finance");
        stage.setScene(new Scene(tabPane, 1024, 720));
        stage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
