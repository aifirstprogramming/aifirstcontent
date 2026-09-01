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
        RecurringObligationService recurringObligationService = new RecurringObligationService(recurringObligationRepository);
        BudgetService budgetService = new BudgetService(categoryRepository, transactionRepository, recurringObligationService);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        SavingsGoalService savingsGoalService = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService);
        MonthSummaryService monthSummaryService = new MonthSummaryService(
                budgetService, savingsGoalService, recurringObligationService);

        MonthSummaryView monthSummaryView = new MonthSummaryView(monthSummaryService);
        TransactionEntryView transactionEntryView = new TransactionEntryView(categoryRepository, transactionRepository);
        CategorySummaryView categorySummaryView = new CategorySummaryView(budgetService);
        SavingsGoalsView savingsGoalsView = new SavingsGoalsView(savingsGoalRepository, savingsGoalService);
        RecurringObligationsView recurringObligationsView = new RecurringObligationsView(
                categoryRepository, recurringObligationRepository, recurringObligationService);

        TabPane tabPane = new TabPane();
        tabPane.getTabs().addAll(
                monthSummaryView.asTab(),
                transactionEntryView.asTab(),
                categorySummaryView.asTab(),
                savingsGoalsView.asTab(),
                recurringObligationsView.asTab());

        // Entering any tab re-pulls the latest data, since transactions/goals/
        // obligations entered in one tab feed the totals shown in the others.
        tabPane.getSelectionModel().selectedItemProperty().addListener((obs, oldTab, newTab) -> {
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
