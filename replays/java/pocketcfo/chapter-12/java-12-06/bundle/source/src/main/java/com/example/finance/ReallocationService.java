package com.example.finance;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.YearMonth;

/**
 * Answers "what if I budgeted less for category X going forward and put
 * that money toward savings goal/obligation Y instead?" — a pure preview,
 * computed from a hypothetical reduction in the category's monthly target
 * (not its already-logged actual spend, since this is a forward-looking
 * planning decision). Nothing here writes a transaction, contribution, or
 * category change.
 */
public class ReallocationService {

    private final BudgetService budgetService;
    private final SavingsGoalService savingsGoalService;
    private final SavingsGoalRepository savingsGoalRepository;
    private final RecurringObligationRepository recurringObligationRepository;
    private final RecurringObligationService recurringObligationService;

    public ReallocationService(BudgetService budgetService, SavingsGoalService savingsGoalService,
                                SavingsGoalRepository savingsGoalRepository,
                                RecurringObligationRepository recurringObligationRepository,
                                RecurringObligationService recurringObligationService) {
        this.budgetService = budgetService;
        this.savingsGoalService = savingsGoalService;
        this.savingsGoalRepository = savingsGoalRepository;
        this.recurringObligationRepository = recurringObligationRepository;
        this.recurringObligationService = recurringObligationService;
    }

    public ReallocationProjection projectToGoal(String categoryName, BigDecimal reductionAmount, String goalName,
                                                 YearMonth month) {
        BudgetService.CategoryTotal categoryTotal = resolveCategory(categoryName, month);
        validateReductionAmount(reductionAmount, categoryTotal);

        SavingsGoal goal = savingsGoalRepository.findAll().stream()
                .filter(g -> g.getName().equals(goalName))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No such savings goal: \"" + goalName + "\"."));

        BigDecimal oldSaved = savingsGoalService.totalSaved(goalName);
        BigDecimal newSaved = oldSaved.add(reductionAmount);
        BigDecimal oldTarget = categoryTotal.getCategory().getMonthlyTarget();

        return new ReallocationProjection(categoryTotal.getCategory(), reductionAmount,
                oldTarget, oldTarget.subtract(reductionAmount),
                goal.getName(), TargetKind.SAVINGS_GOAL,
                oldSaved, newSaved,
                percentOf(oldSaved, goal.getTargetAmount()), percentOf(newSaved, goal.getTargetAmount()));
    }

    public ReallocationProjection projectToObligation(String categoryName, BigDecimal reductionAmount,
                                                        String obligationName, YearMonth month) {
        BudgetService.CategoryTotal categoryTotal = resolveCategory(categoryName, month);
        validateReductionAmount(reductionAmount, categoryTotal);

        RecurringObligation obligation = recurringObligationRepository.findAll().stream()
                .filter(o -> o.getName().equals(obligationName))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No such obligation: \"" + obligationName + "\"."));

        BigDecimal oldPaid = recurringObligationService.totalPaid(obligation);
        BigDecimal newPaid = oldPaid.add(reductionAmount);
        BigDecimal oldTarget = categoryTotal.getCategory().getMonthlyTarget();

        return new ReallocationProjection(categoryTotal.getCategory(), reductionAmount,
                oldTarget, oldTarget.subtract(reductionAmount),
                obligation.getName(), TargetKind.RECURRING_OBLIGATION,
                oldPaid, newPaid,
                percentOf(oldPaid, obligation.getAmount()), percentOf(newPaid, obligation.getAmount()));
    }

    private void validateReductionAmount(BigDecimal reductionAmount, BudgetService.CategoryTotal categoryTotal) {
        if (reductionAmount == null || reductionAmount.signum() <= 0) {
            throw new IllegalArgumentException("Reduction amount must be positive.");
        }
        BigDecimal monthlyTarget = categoryTotal.getCategory().getMonthlyTarget();
        if (reductionAmount.compareTo(monthlyTarget) > 0) {
            throw new IllegalArgumentException("Reduction amount cannot exceed the category's monthly target of $"
                    + monthlyTarget + ".");
        }
    }

    private BudgetService.CategoryTotal resolveCategory(String categoryName, YearMonth month) {
        return budgetService.categoryTotals(month).stream()
                .filter(t -> t.getCategory().getName().equals(categoryName))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No such category: \"" + categoryName + "\"."));
    }

    private static double percentOf(BigDecimal amount, BigDecimal target) {
        return target.signum() <= 0 ? 0.0 : amount.divide(target, 4, RoundingMode.HALF_UP).doubleValue();
    }

    public enum TargetKind {
        SAVINGS_GOAL, RECURRING_OBLIGATION
    }

    public static class ReallocationProjection {
        private final Category category;
        private final BigDecimal reductionAmount;
        private final BigDecimal oldMonthlyTarget;
        private final BigDecimal newMonthlyTarget;
        private final String targetName;
        private final TargetKind targetKind;
        private final BigDecimal oldAllocatedToTarget;
        private final BigDecimal newAllocatedToTarget;
        private final double oldProgressPercent;
        private final double newProgressPercent;

        public ReallocationProjection(Category category, BigDecimal reductionAmount,
                                       BigDecimal oldMonthlyTarget, BigDecimal newMonthlyTarget,
                                       String targetName, TargetKind targetKind,
                                       BigDecimal oldAllocatedToTarget, BigDecimal newAllocatedToTarget,
                                       double oldProgressPercent, double newProgressPercent) {
            this.category = category;
            this.reductionAmount = reductionAmount;
            this.oldMonthlyTarget = oldMonthlyTarget;
            this.newMonthlyTarget = newMonthlyTarget;
            this.targetName = targetName;
            this.targetKind = targetKind;
            this.oldAllocatedToTarget = oldAllocatedToTarget;
            this.newAllocatedToTarget = newAllocatedToTarget;
            this.oldProgressPercent = oldProgressPercent;
            this.newProgressPercent = newProgressPercent;
        }

        public Category getCategory() {
            return category;
        }

        public BigDecimal getReductionAmount() {
            return reductionAmount;
        }

        public BigDecimal getOldMonthlyTarget() {
            return oldMonthlyTarget;
        }

        public BigDecimal getNewMonthlyTarget() {
            return newMonthlyTarget;
        }

        public String getTargetName() {
            return targetName;
        }

        public TargetKind getTargetKind() {
            return targetKind;
        }

        public BigDecimal getOldAllocatedToTarget() {
            return oldAllocatedToTarget;
        }

        public BigDecimal getNewAllocatedToTarget() {
            return newAllocatedToTarget;
        }

        public double getOldProgressPercent() {
            return oldProgressPercent;
        }

        public double getNewProgressPercent() {
            return newProgressPercent;
        }
    }
}
