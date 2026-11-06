/**
 * Simulated economy. All amounts are fictional simulation credits (§).
 *
 * Money flows: citizens earn salaries from employers (or the city budget for
 * public services), pay rent to housing operators, buy meals / goods / leisure
 * from businesses, and pay fares. Businesses pay wages, utilities and
 * restocking; companies sell services in proportion to staff actually at work.
 * The city collects income, sales and property tax and pays for maintenance,
 * transit and public services. Power and water demand follow occupancy.
 */
import type { ActivityKind, Business, BuildingDef, TravelMode } from '@morphis/shared';
import { BUILDING_TYPES, dayOf, daylight, hourOf, isOpenAt } from '@morphis/shared';
import type { CitizenRT } from '../state';
import type { CitySimulation } from '../engine';

const INCOME_TAX = 0.12;
const SALES_TAX = 0.08;
const PROPERTY_TAX = 0.06;

const CATEGORY: Record<string, Business['category']> = {
  food: 'food',
  retail: 'retail',
  office: 'company',
  research: 'company',
  industry: 'industry',
  leisure: 'service',
  residential: 'housing',
  education: 'public',
  health: 'public',
  civic: 'public',
  infrastructure: 'public',
};

const PRODUCTS: Partial<Record<string, string[]>> = {
  company: ['Cloud services', 'Analytics platform', 'Consulting', 'Software licences'],
  industry: ['Fabricated components', 'Drone parts', 'Logistics capacity'],
  food: ['Meals', 'Coffee'],
  retail: ['Consumer goods', 'Electronics'],
  service: ['Tickets', 'Experiences'],
  finance: ['Accounts', 'Loans', 'Trading'],
};

export function createBusinesses(sim: CitySimulation): Business[] {
  const out: Business[] = [];
  for (const b of sim.world.buildings) {
    const meta = BUILDING_TYPES[b.type];
    if (meta.category === 'open') continue;
    let category = CATEGORY[meta.category] ?? 'service';
    if (b.type === 'bank') category = 'finance';
    if (b.type === 'hq' || b.type === 'transit_hub' || b.type === 'data_center') category = b.type === 'data_center' ? 'company' : 'public';
    const inv = category === 'food' || category === 'retail' ? 200 : category === 'industry' ? 400 : 0;
    out.push({
      id: `biz_${b.id.slice(9)}`,
      name: b.name,
      type: b.type,
      buildingId: b.id,
      category,
      employees: [],
      jobs: b.jobs,
      revenue: 0,
      expenses: 0,
      revenueToday: 0,
      expensesToday: 0,
      profit: 0,
      cash: category === 'public' ? 0 : Math.round(5000 + b.jobs * 400 + (b.named ? 40000 : 0)),
      inventory: inv,
      inventoryCapacity: inv,
      capacity: b.capacity,
      operatingStatus: b.construction ? 'PLANNED' : 'OPEN',
      pricePerVisit: meta.price,
      visitsToday: 0,
      restockPending: false,
      products: PRODUCTS[category] ?? [],
    });
  }
  return out;
}

export class EconomySystem {
  private bizByBuilding = new Map<string, Business>();
  private bizById = new Map<string, Business>();

  constructor(private sim: CitySimulation) {
    this.reindex();
  }

  reindex(): void {
    this.bizByBuilding.clear();
    this.bizById.clear();
    for (const b of this.sim.state.businesses) {
      this.bizByBuilding.set(b.buildingId, b);
      this.bizById.set(b.id, b);
    }
  }

  /** Derive employee lists from citizen workplaces (fresh cities only; saves carry their own lists). */
  rebuildEmployees(): void {
    for (const b of this.sim.state.businesses) b.employees = [];
    for (const c of this.sim.state.citizens) {
      if (c.profile.workplaceId && c.dyn.employed) this.bizByBuilding.get(c.profile.workplaceId)?.employees.push(c.profile.id);
    }
  }

  byBuilding(id: string): Business | undefined {
    return this.bizByBuilding.get(id);
  }

  byId(id: string): Business | undefined {
    return this.bizById.get(id);
  }

  private get e() {
    return this.sim.state.economy;
  }

  // ---------------------------------------------------------------- transactions

  /** A citizen arrived somewhere; buy something if it is a business they came to use. */
  onVisit(c: CitizenRT, buildingId: string, activity: ActivityKind): void {
    if (!['eat', 'shop', 'leisure', 'event'].includes(activity)) return;
    const biz = this.bizByBuilding.get(buildingId);
    if (!biz || biz.operatingStatus !== 'OPEN' || biz.pricePerVisit <= 0) return;
    const price = Math.round(biz.pricePerVisit * this.sim.rng.range(0.75, 1.3));
    if (c.dyn.money < price) {
      c.dyn.happiness = Math.max(0, c.dyn.happiness - 0.03);
      return;
    }
    if ((biz.category === 'food' || biz.category === 'retail') && biz.inventory <= 0) return;
    c.dyn.money -= price;
    const tax = price * SALES_TAX;
    biz.revenueToday += price - tax;
    biz.revenue += price - tax;
    biz.cash += price - tax;
    biz.visitsToday++;
    this.e.salesTaxToday += tax;
    if (biz.category === 'food') {
      c.dyn.spending.food += price;
      c.dyn.satiety = Math.min(1, c.dyn.satiety + 0.55);
      biz.inventory -= 1;
    } else if (biz.category === 'retail') {
      c.dyn.spending.shopping += price;
      c.dyn.fun = Math.min(1, c.dyn.fun + 0.12);
      biz.inventory -= 1;
    } else {
      c.dyn.spending.entertainment += price;
      c.dyn.fun = Math.min(1, c.dyn.fun + 0.25);
    }
    if (biz.inventoryCapacity > 0 && biz.inventory < biz.inventoryCapacity * 0.3 && !biz.restockPending) {
      biz.restockPending = this.sim.traffic.requestDelivery(biz.id);
    }
  }

  transport(c: CitizenRT, cost: number, mode: TravelMode): void {
    const paid = Math.min(cost, Math.max(0, c.dyn.money));
    c.dyn.money -= paid;
    c.dyn.spending.transport += paid;
    if (mode === 'bus' || mode === 'rail') this.e.transitToday -= paid; // fares offset transit costs
    if (mode === 'taxi') {
      const hub = this.sim.landmark('station');
      const biz = hub ? this.bizByBuilding.get(hub.id) : undefined;
      if (biz) {
        biz.revenueToday += paid;
        biz.cash += paid;
      }
    }
  }

  deliver(businessId: string): void {
    const biz = this.bizById.get(businessId);
    if (!biz) return;
    const units = biz.inventoryCapacity - biz.inventory;
    const cost = Math.round(units * (biz.category === 'food' ? 3 : 7));
    biz.inventory = biz.inventoryCapacity;
    biz.restockPending = false;
    biz.cash -= cost;
    biz.expensesToday += cost;
    biz.expenses += cost;
    // supplier revenue goes to a random industrial business
    const suppliers = this.sim.state.businesses.filter((b) => b.category === 'industry' && b.operatingStatus === 'OPEN');
    if (suppliers.length) {
      const s = this.sim.rng.pick(suppliers);
      s.revenueToday += cost;
      s.revenue += cost;
      s.cash += cost;
      s.inventory = Math.max(0, s.inventory - units);
    }
  }

  // ---------------------------------------------------------------- hourly

  hourly(): void {
    const sim = this.sim;
    const h = hourOf(sim.time);
    const st = sim.state;
    let power = 0;
    let water = 0;
    for (const biz of st.businesses) {
      const b = sim.building(biz.buildingId);
      const bd = st.buildings[b.index];
      const open = isOpenAt(b.type, h) && biz.operatingStatus === 'OPEN';
      if (bd.dyn.status !== 'CONSTRUCTION' && bd.dyn.status !== 'OUTAGE') bd.dyn.status = open || BUILDING_TYPES[b.type].category === 'residential' ? 'ACTIVE' : 'CLOSED';
      const present = bd.occupants.length;
      const occ = Math.min(1, present / Math.max(4, b.capacity * 0.15));
      const base = BUILDING_TYPES[b.type].energy;
      bd.dyn.energyUsage = round2(Math.min(1, base * (0.18 + (open ? 0.45 : 0.05) + occ * 0.37)));
      bd.dyn.employees = biz.employees.length;
      const size = Math.max(1, (b.width * b.depth * Math.max(1, b.floorCount)) / 400);
      power += bd.dyn.energyUsage * size;
      water += (present * 0.05 + (open ? 0.2 : 0.05)) * Math.sqrt(size);
      if (biz.category === 'public' || biz.category === 'housing') continue;
      // utilities
      const util = bd.dyn.energyUsage * size * 0.9;
      biz.cash -= util;
      biz.expensesToday += util;
      biz.expenses += util;
      this.e.utilitiesToday += util * 0.15;
      if (!open) continue;
      // service revenue in proportion to staff present (companies, finance, industry)
      const staff = bd.occupants.filter((id) => biz.employees.includes(id)).length;
      let rev = 0;
      if (biz.category === 'company') rev = staff * 58 + (biz.employees.length === 0 ? 6 : 0);
      else if (biz.category === 'finance') rev = staff * 64 + 10;
      else if (biz.category === 'industry') {
        rev = staff * 38 + 4;
        biz.inventory = Math.min(biz.inventoryCapacity, biz.inventory + staff * 3 + 2);
      }
      if (rev > 0) {
        biz.revenueToday += rev;
        biz.revenue += rev;
        biz.cash += rev;
      }
    }
    const fusion = sim.landmark('fusion');
    const supply = (fusion ? 900 : 500) + 260 * daylight(sim.time);
    const water0 = sim.landmark('water') ? 260 : 150;
    this.e.summary.resources = {
      powerDemand: Math.round(power),
      powerSupply: Math.round(supply),
      waterDemand: Math.round(water),
      waterSupply: water0,
    };
    this.refreshSummary(false);
  }

  // ---------------------------------------------------------------- daily (midnight)

  daily(): void {
    const sim = this.sim;
    const st = sim.state;
    const e = this.e;
    const day = dayOf(sim.time) - 1;
    // wages & rent
    for (const c of st.citizens) {
      const p = c.profile;
      if (p.salary > 0 && (c.dyn.employed || p.occupation === 'Retired' || p.occupation === 'Student')) {
        const gross = p.salary / 30;
        const tax = c.dyn.employed ? gross * INCOME_TAX : 0;
        c.dyn.money += gross - tax;
        c.dyn.earnedThisMonth += gross - tax;
        e.incomeTaxToday += tax;
        const biz = p.workplaceId && c.dyn.employed ? this.bizByBuilding.get(p.workplaceId) : undefined;
        if (biz && biz.category !== 'public') {
          biz.cash -= gross;
          biz.expensesToday += gross;
          biz.expenses += gross;
        } else {
          e.salaryPaidToday += gross; // public sector, pensions and stipends
        }
      }
      const rent = p.rent / 30;
      const paid = Math.min(rent, Math.max(0, c.dyn.money));
      c.dyn.money -= paid;
      c.dyn.spending.rent += paid;
      const landlord = this.bizByBuilding.get(p.homeId);
      if (landlord) {
        landlord.revenueToday += paid * (1 - PROPERTY_TAX);
        landlord.cash += paid * (1 - PROPERTY_TAX);
        e.propertyTaxToday += paid * PROPERTY_TAX;
      }
      // move surplus into savings
      if (c.dyn.money > p.salary * 1.5 + 500) {
        const extra = c.dyn.money - (p.salary * 1.5 + 500);
        c.dyn.money -= extra;
        c.dyn.savings += extra;
      } else if (c.dyn.money < 100 && c.dyn.savings > 0) {
        const pull = Math.min(c.dyn.savings, 400);
        c.dyn.savings -= pull;
        c.dyn.money += pull;
      }
      if (day % 30 === 0) {
        c.dyn.spending = { food: 0, shopping: 0, transport: 0, entertainment: 0, rent: 0 };
        c.dyn.earnedThisMonth = 0;
      }
    }
    // city costs
    const roadLength = sim.world.roads.edges.reduce((a, r) => a + r.length, 0);
    e.maintenanceToday += roadLength * 0.35;
    const buses = st.vehicles.filter((v) => v.info.kind === 'bus' && v.active).length;
    e.transitToday += buses * 220;
    // business results, hiring and layoffs
    let gdp = 0;
    for (const biz of st.businesses) {
      gdp += biz.revenueToday;
      biz.profit = Math.round(biz.revenueToday - biz.expensesToday);
      if (biz.category === 'company' || biz.category === 'finance' || biz.category === 'industry' || biz.category === 'food' || biz.category === 'retail') {
        e.propertyTaxToday += Math.max(0, biz.revenueToday) * 0.02;
        biz.cash -= Math.max(0, biz.revenueToday) * 0.02;
        if (biz.profit > 150 && biz.employees.length < biz.jobs) this.hire(biz, 1 + (biz.profit > 1500 ? 1 : 0));
        if (biz.cash < -4000 && biz.employees.length > 0) this.layoff(biz);
      }
      biz.revenueToday = 0;
      biz.expensesToday = 0;
      biz.visitsToday = 0;
    }
    const income = e.incomeTaxToday + e.salesTaxToday + e.propertyTaxToday;
    const costs = e.salaryPaidToday + e.utilitiesToday + e.maintenanceToday + e.transitToday;
    e.summary.cityBudget = Math.round(e.summary.cityBudget + income - costs);
    e.summary.taxRevenueToday = Math.round(income);
    e.summary.cityExpensesToday = Math.round(costs);
    e.summary.gdpYesterday = Math.round(gdp);
    this.refreshSummary(true);
    e.summary.history.push({
      day,
      gdp: Math.round(gdp),
      budget: e.summary.cityBudget,
      happiness: round2(e.summary.avgHappiness),
      employment: e.summary.employed,
    });
    if (e.summary.history.length > 30) e.summary.history.shift();
    sim.cityEvents.economyReport(day, gdp, income - costs);
    e.incomeTaxToday = 0;
    e.salesTaxToday = 0;
    e.propertyTaxToday = 0;
    e.salaryPaidToday = 0;
    e.utilitiesToday = 0;
    e.maintenanceToday = 0;
    e.transitToday = 0;
    e.summary.transitRidersToday = 0;
    e.summary.taxiTripsToday = 0;
    e.lastDay = day;
    sim.bus.emit('economy.updated', sim.time, { summary: e.summary });
  }

  hire(biz: Business, n: number): number {
    const sim = this.sim;
    let hired = 0;
    for (const c of sim.state.citizens) {
      if (hired >= n) break;
      if (c.dyn.employed || c.profile.core || c.profile.agent || c.profile.age >= 65 || c.profile.occupation === 'Student') continue;
      c.dyn.employed = true;
      c.profile.workplaceId = biz.buildingId;
      c.profile.occupation = 'Associate';
      c.profile.department = biz.name;
      c.profile.salary = Math.round(sim.rng.range(3000, 5200) / 10) * 10;
      const sched = sim.makeSchedule('day');
      c.profile.schedule = sched.weekday;
      biz.employees.push(c.profile.id);
      hired++;
      sim.life?.addDeed(c, 'hired', `Joined ${biz.name} as an associate.`, 'sim', { buildingId: biz.buildingId, silent: true });
      sim.cityEvents.news('economy', `${biz.name} hires ${c.profile.name}`, `${c.profile.name} joins ${biz.name} as an associate (simulated employment).`, 'info', biz.buildingId);
    }
    return hired;
  }

  private layoff(biz: Business): void {
    const id = biz.employees.pop();
    const c = id ? this.sim.citizenById(id) : undefined;
    if (!c || c.profile.core || c.profile.agent) return;
    c.dyn.employed = false;
    c.profile.workplaceId = null;
    c.profile.occupation = 'Job Seeker';
    c.profile.department = 'Unemployed';
    c.profile.salary = 0;
    this.sim.cityEvents.news('economy', `${biz.name} cuts staff`, `${biz.name} is losing money and laid off ${c.profile.name}.`, 'notice', biz.buildingId);
  }

  /** Open a new company in an existing (vacant or construction) building. */
  foundCompany(name: string, building: BuildingDef, products: string[]): Business | null {
    const sim = this.sim;
    const biz = this.bizByBuilding.get(building.id);
    if (!biz) return null;
    biz.name = name;
    biz.category = 'company';
    biz.operatingStatus = 'OPEN';
    biz.cash = 60000;
    biz.products = products;
    biz.jobs = Math.max(biz.jobs, 8);
    const bd = sim.state.buildings[building.index];
    bd.dyn.status = 'ACTIVE';
    bd.dyn.ownerId = biz.id;
    sim.bus.emit('building.updated', sim.time, { buildingId: building.id, state: bd.dyn });
    this.hire(biz, 4);
    return biz;
  }

  refreshSummary(daily: boolean): void {
    const st = this.sim.state;
    const s = this.e.summary;
    let employed = 0;
    let unemployed = 0;
    let happy = 0;
    let money = 0;
    for (const c of st.citizens) {
      if (c.dyn.employed) employed++;
      else if (c.profile.occupation === 'Job Seeker') unemployed++;
      happy += c.dyn.happiness;
      money += c.dyn.money;
    }
    const n = Math.max(1, st.citizens.length);
    s.employed = employed;
    s.unemployed = unemployed;
    s.avgHappiness = round2(happy / n);
    s.avgMoney = Math.round(money / n);
    s.businessesOpen = st.businesses.filter((b) => b.operatingStatus === 'OPEN' && b.category !== 'housing' && b.category !== 'public').length;
    const homes = this.sim.world.buildings.filter((b) => BUILDING_TYPES[b.type].category === 'residential');
    const cap = homes.reduce((a, b) => a + b.capacity, 0);
    s.housingOccupancy = round2(st.citizens.length / Math.max(1, cap));
    let gdp = 0;
    for (const b of st.businesses) gdp += b.revenueToday;
    s.gdpToday = Math.round(gdp);
    if (!daily) {
      const e = this.e;
      s.taxRevenueToday = Math.round(e.incomeTaxToday + e.salesTaxToday + e.propertyTaxToday);
    }
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
