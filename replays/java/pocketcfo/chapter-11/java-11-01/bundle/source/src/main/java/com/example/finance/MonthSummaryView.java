package com.example.finance;

import javafx.collections.FXCollections;
import javafx.geometry.Insets;
import javafx.scene.chart.BarChart;
import javafx.scene.chart.CategoryAxis;
import javafx.scene.chart.NumberAxis;
import javafx.scene.chart.PieChart;
import javafx.scene.chart.XYChart;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.Tab;
import javafx.scene.layout.VBox;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/**
 * The "awareness budgeting" dashboard: leftover, warnings, goal and
 * upcoming-payment callouts, and the two headline charts, all for one month.
 */
public class MonthSummaryView {

    private final MonthSummaryService monthSummaryService;
    private final YearMonth month;

    private final VBox root = new VBox(12);
    private final Label leftoverLabel = new Label();
    private final Label warningLabel = new Label();
    private final Label goalsLabel = new Label();
    private final Label upcomingLabel = new Label();
    private final VBox chartsBox = new VBox(12);

    public MonthSummaryView(MonthSummaryService monthSummaryService) {
        this(monthSummaryService, YearMonth.now());
    }

    public MonthSummaryView(MonthSummaryService monthSummaryService, YearMonth month) {
        this.monthSummaryService = monthSummaryService;
        this.month = month;
        buildLayout();
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Month Summary", root);
        tab.setClosable(false);
        return tab;
    }

    private void buildLayout() {
        Button refreshButton = new Button("Refresh");
        refreshButton.setOnAction(e -> refresh());
        root.setPadding(new Insets(12));
        root.getChildren().addAll(leftoverLabel, warningLabel, goalsLabel, upcomingLabel, chartsBox, refreshButton);
    }

    public void refresh() {
        MonthSummaryService.MonthSummary summary = monthSummaryService.summarize(month, LocalDate.now());

        leftoverLabel.setText(String.format("Income %s − Expenses %s = Leftover %s (available to allocate: %s)",
                summary.getTotalIncome(), summary.getTotalExpenses(), summary.getLeftover(),
                summary.getAvailableLeftover()));

        warningLabel.setText(summary.getOverBudgetCount() == 0
                ? "All categories are within target."
                : summary.getOverBudgetCount() + " categor"
                        + (summary.getOverBudgetCount() == 1 ? "y is" : "ies are") + " over budget.");

        long goalsReached = summary.getGoalProgress().stream()
                .filter(g -> g.getSavedAmount().compareTo(g.getGoal().getTargetAmount()) >= 0)
                .count();
        goalsLabel.setText(summary.getGoalProgress().size() + " savings goal(s), " + goalsReached + " reached.");

        upcomingLabel.setText(summary.getUpcomingPayments().size() + " payment(s) due in the next 60 days.");

        chartsBox.getChildren().setAll(buildPieChart(summary), buildBarChart(summary));
    }

    private PieChart buildPieChart(MonthSummaryService.MonthSummary summary) {
        List<PieChart.Data> slices = summary.getCategoryTotals().stream()
                .filter(t -> t.getActual().signum() > 0)
                .map(t -> new PieChart.Data(t.getCategory().getName(), t.getActual().doubleValue()))
                .toList();
        PieChart pieChart = new PieChart(FXCollections.observableArrayList(slices));
        pieChart.setTitle("Spending by category");
        return pieChart;
    }

    private BarChart<String, Number> buildBarChart(MonthSummaryService.MonthSummary summary) {
        BarChart<String, Number> barChart = new BarChart<>(new CategoryAxis(), new NumberAxis());
        barChart.setTitle("Target vs. actual by category");

        XYChart.Series<String, Number> targetSeries = new XYChart.Series<>();
        targetSeries.setName("Target");
        XYChart.Series<String, Number> actualSeries = new XYChart.Series<>();
        actualSeries.setName("Actual");

        for (BudgetService.CategoryTotal total : summary.getCategoryTotals()) {
            String name = total.getCategory().getName();
            targetSeries.getData().add(new XYChart.Data<>(name, total.getCategory().getMonthlyTarget().doubleValue()));
            actualSeries.getData().add(new XYChart.Data<>(name, total.getActual().doubleValue()));
        }

        barChart.getData().addAll(targetSeries, actualSeries);
        return barChart;
    }
}
