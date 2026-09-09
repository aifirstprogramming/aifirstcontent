package com.example.finance;

import javafx.beans.property.ReadOnlyObjectProperty;
import javafx.beans.property.SimpleIntegerProperty;
import javafx.beans.property.SimpleObjectProperty;
import javafx.beans.property.SimpleStringProperty;
import javafx.collections.FXCollections;
import javafx.geometry.Insets;
import javafx.scene.chart.BarChart;
import javafx.scene.chart.CategoryAxis;
import javafx.scene.chart.NumberAxis;
import javafx.scene.chart.PieChart;
import javafx.scene.chart.XYChart;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ScrollPane;
import javafx.scene.control.Separator;
import javafx.scene.control.Tab;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableRow;
import javafx.scene.control.TableView;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
    private final Label priorityAlignmentHeaderLabel = new Label();
    private final Label idealizedListLabel = new Label("Idealized Priority (by rank)");
    private final Label actualListLabel = new Label("Actual Priority (by spend)");
    private final VBox idealizedPriorityBox = new VBox(6);
    private final VBox actualSpendBox = new VBox(6);

    public MonthSummaryView(MonthSummaryService monthSummaryService, ReadOnlyObjectProperty<YearMonth> selectedMonth) {
        this.monthSummaryService = monthSummaryService;
        this.selectedMonth = selectedMonth;
        buildLayout();
        refresh();
    }

    public Tab asTab() {
        ScrollPane scrollPane = new ScrollPane(root);
        scrollPane.setFitToWidth(true);
        Tab tab = new Tab("Month Summary", scrollPane);
        tab.setClosable(false);
        return tab;
    }

    private void buildLayout() {
        for (Label label : List.of(leftoverLabel, warningLabel, goalsLabel, upcomingLabel,
                ytdHeaderLabel, ytdSummaryLabel, ytdWarningLabel, priorityAlignmentHeaderLabel)) {
            label.setWrapText(true);
        }
        Button refreshButton = new Button("Refresh");
        refreshButton.setOnAction(e -> refresh());
        root.setPadding(new Insets(12));

        VBox idealizedColumn = new VBox(6, idealizedListLabel, idealizedPriorityBox);
        VBox actualColumn = new VBox(6, actualListLabel, actualSpendBox);
        HBox priorityListsRow = new HBox(24, idealizedColumn, actualColumn);

        root.getChildren().addAll(leftoverLabel, warningLabel, goalsLabel, upcomingLabel, chartsBox,
                new Separator(), ytdHeaderLabel, ytdSummaryLabel, ytdWarningLabel, ytdChartsBox,
                new Separator(), priorityAlignmentHeaderLabel, priorityListsRow,
                refreshButton);
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

        List<BudgetService.CategoryTotal> idealized = monthSummaryService.summarizeIdealizedPriorityList(month);
        List<BudgetService.CategoryTotal> actualSpend = monthSummaryService.summarizeActualSpendList(month);
        priorityAlignmentHeaderLabel.setText("Priority vs. Actual Spend — " + month.getMonth() + " " + month.getYear());
        idealizedPriorityBox.getChildren().setAll(buildIdealizedPriorityTable(idealized));
        actualSpendBox.getChildren().setAll(buildActualSpendTable(actualSpend, idealized));
    }

    private TableView<BudgetService.CategoryTotal> buildIdealizedPriorityTable(List<BudgetService.CategoryTotal> idealized) {
        TableView<BudgetService.CategoryTotal> table = new TableView<>(FXCollections.observableArrayList(idealized));
        table.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);

        TableColumn<BudgetService.CategoryTotal, Number> priorityCol = new TableColumn<>("Priority");
        priorityCol.setCellValueFactory(cell ->
                new SimpleIntegerProperty(cell.getValue().getCategory().getPriority().orElseThrow()));

        TableColumn<BudgetService.CategoryTotal, String> nameCol = new TableColumn<>("Category");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getCategory().getName()));

        table.getColumns().addAll(priorityCol, nameCol);
        return table;
    }

    /**
     * Every spending category ranked by actual spend, with prioritized
     * categories highlighted so it's easy to spot where they actually land
     * against the full field — not just against each other.
     */
    private TableView<BudgetService.CategoryTotal> buildActualSpendTable(List<BudgetService.CategoryTotal> actualSpend,
                                                                            List<BudgetService.CategoryTotal> idealized) {
        Set<String> prioritizedNames = new HashSet<>();
        for (BudgetService.CategoryTotal total : idealized) {
            prioritizedNames.add(total.getCategory().getName());
        }
        Map<String, Integer> rankByName = new HashMap<>();
        for (int i = 0; i < actualSpend.size(); i++) {
            rankByName.put(actualSpend.get(i).getCategory().getName(), i + 1);
        }

        TableView<BudgetService.CategoryTotal> table = new TableView<>(FXCollections.observableArrayList(actualSpend));
        table.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);

        TableColumn<BudgetService.CategoryTotal, Number> rankCol = new TableColumn<>("Rank");
        rankCol.setCellValueFactory(cell ->
                new SimpleIntegerProperty(rankByName.get(cell.getValue().getCategory().getName())));

        TableColumn<BudgetService.CategoryTotal, String> nameCol = new TableColumn<>("Category");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getCategory().getName()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> actualCol = new TableColumn<>("Actual");
        actualCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getActual()));

        table.getColumns().addAll(rankCol, nameCol, actualCol);

        table.setRowFactory(tv -> new TableRow<>() {
            @Override
            protected void updateItem(BudgetService.CategoryTotal item, boolean empty) {
                super.updateItem(item, empty);
                setStyle(!empty && item != null && prioritizedNames.contains(item.getCategory().getName())
                        ? "-fx-background-color: #fff3cd;" : "");
            }
        });

        return table;
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
