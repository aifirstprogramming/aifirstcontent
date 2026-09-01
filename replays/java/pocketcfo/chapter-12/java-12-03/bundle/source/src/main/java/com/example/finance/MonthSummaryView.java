package com.example.finance;

import javafx.beans.property.ReadOnlyObjectProperty;
import javafx.collections.FXCollections;
import javafx.geometry.Insets;
import javafx.scene.chart.BarChart;
import javafx.scene.chart.CategoryAxis;
import javafx.scene.chart.NumberAxis;
import javafx.scene.chart.PieChart;
import javafx.scene.chart.XYChart;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.Separator;
import javafx.scene.control.Tab;
import javafx.scene.layout.VBox;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/**
 * The "awareness budgeting" dashboard: leftover, warnings, goal and
 * upcoming-payment callouts, and the two headline charts, all for one month,
 * plus a year-to-date rollup section below it.
 */
public class MonthSummaryView {

    private final MonthSummaryService monthSummaryService;
    private final ReadOnlyObjectProperty<YearMonth> selectedMonth;

    private final VBox root = new VBox(12);
    private final Label leftoverLabel = new Label();
    private final Label warningLabel = new Label();
    private final Label goalsLabel = new Label();
    private final Label upcomingLabel = new Label();
    private final VBox chartsBox = new VBox(12);
    private final Label ytdHeaderLabel = new Label();
    private final Label ytdSummaryLabel = new Label();
    private final Label ytdWarningLabel = new Label();
    private final VBox ytdChartsBox = new VBox(12);

    public MonthSummaryView(MonthSummaryService monthSummaryService, ReadOnlyObjectProperty<YearMonth> selectedMonth) {
        this.monthSummaryService = monthSummaryService;
        this.selectedMonth = selectedMonth;
        buildLayout();
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Month Summary", root);
        tab.setClosable(false);
        return tab;
    }

    private void buildLayout() {
        for (Label label : List.of(leftoverLabel, warningLabel, goalsLabel, upcomingLabel,
                ytdHeaderLabel, ytdSummaryLabel, ytdWarningLabel)) {
            label.setWrapText(true);
        }
        Button refreshButton = new Button("Refresh");
        refreshButton.setOnAction(e -> refresh());
        root.setPadding(new Insets(12));
        root.getChildren().addAll(leftoverLabel, warningLabel, goalsLabel, upcomingLabel, chartsBox,
                new Separator(), ytdHeaderLabel, ytdSummaryLabel, ytdWarningLabel, ytdChartsBox, refreshButton);
    }

    public void refresh() {
        YearMonth month = selectedMonth.get();
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

        MonthSummaryService.YearToDateSummary ytd = monthSummaryService.summarizeYearToDate(month);

        ytdHeaderLabel.setText("Year to Date (Jan–" + month.getMonth() + " " + ytd.getYear() + ")");
        ytdSummaryLabel.setText(String.format("YTD Income %s − YTD Expenses %s = YTD Leftover %s",
                ytd.getTotalIncome(), ytd.getTotalExpenses(), ytd.getLeftover()));
        ytdWarningLabel.setText(ytd.getOverBudgetCount() == 0
                ? "All categories are within their YTD target."
                : ytd.getOverBudgetCount() + " categor"
                        + (ytd.getOverBudgetCount() == 1 ? "y is" : "ies are") + " over YTD target.");
        ytdChartsBox.getChildren().setAll(buildYtdBarChart(ytd));
    }

    private PieChart buildPieChart(MonthSummaryService.MonthSummary summary) {
        List<PieChart.Data> slices = summary.getCategoryTotals().stream()
                .filter(t -> !t.isIncomeOnly())
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

        // Income categories (e.g. a paycheck) are excluded — both charts
        // are about spending, and mixing income in would either dwarf real
        // spending slices or look like a wildly underspent category.
        for (BudgetService.CategoryTotal total : summary.getCategoryTotals()) {
            if (total.isIncomeOnly()) {
                continue;
            }
            String name = total.getCategory().getName();
            targetSeries.getData().add(new XYChart.Data<>(name, total.getCategory().getMonthlyTarget().doubleValue()));
            actualSeries.getData().add(new XYChart.Data<>(name, total.getActual().doubleValue()));
        }

        barChart.getData().addAll(targetSeries, actualSeries);
        return barChart;
    }

    private BarChart<String, Number> buildYtdBarChart(MonthSummaryService.YearToDateSummary ytd) {
        BarChart<String, Number> barChart = new BarChart<>(new CategoryAxis(), new NumberAxis());
        barChart.setTitle("YTD scaled target vs. actual by category");

        XYChart.Series<String, Number> targetSeries = new XYChart.Series<>();
        targetSeries.setName("Scaled Target");
        XYChart.Series<String, Number> actualSeries = new XYChart.Series<>();
        actualSeries.setName("YTD Actual");

        for (BudgetService.YtdCategoryTotal total : ytd.getCategoryTotals()) {
            if (total.isIncomeOnly()) {
                continue;
            }
            String name = total.getCategory().getName();
            targetSeries.getData().add(new XYChart.Data<>(name, total.getScaledTarget().doubleValue()));
            actualSeries.getData().add(new XYChart.Data<>(name, total.getActual().doubleValue()));
        }

        barChart.getData().addAll(targetSeries, actualSeries);
        return barChart;
    }
}
