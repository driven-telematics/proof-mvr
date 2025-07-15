 interface MVRViolation {
	violation_date: string;
	conviction_date?: string;
	location?: string;
	points_assessed?: number;
	violation_code?: string;
	description?: string;
}

 interface MVRWithdrawal {
	effective_date: string;
	eligibility_date?: string;
	action_type?: string;
	reason?: string;
}

 interface MVRAccident {
	accident_date: string;
	location?: string;
	acd_code?: string;
	description?: string;
}

 interface MVRCrime {
	crime_date: string;
	conviction_date?: string;
	offense_code?: string;
	description?: string;
}

 interface MVRData {
	drivers_license_number: string;
	full_legal_name: string;
	birthdate: string;
	weight: string;
	sex: string;
	height: string;
	hair_color: string;
	eye_color: string;
	medical_information?: string;
	address?: string;
	city?: string;
	issued_state_code: string;
	zip?: number;
	phone_number?: number;
	email?: string;

	claim_number?: string;
	order_id?: string;
	order_date?: string;
	report_date?: string;
	reference_number?: string;
	system_use?: string;
	mvr_type?: string;
	state_code: string;
	purpose?: string;
	time_frame?: string;
	is_certified?: boolean;
	total_points?: number;

	license_class?: string;
	issue_date?: string;
	expiration_date?: string;
	status?: string;
	restrictions?: string;

	violations?: MVRViolation[];
	withdrawals?: MVRWithdrawal[];
	accidents?: MVRAccident[];
	crimes?: MVRCrime[];
}

 function generateSampleMVRData(driversLicenseNumber: string): MVRData {
	const getRandomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

	const getRandomDate = (startYear: number, endYear: number): string => {
		const start = new Date(startYear, 0, 1);
		const end = new Date(endYear, 11, 31);
		const randomTime = start.getTime() + Math.random() * (end.getTime() - start.getTime());
		return new Date(randomTime).toISOString().split("T")[0];
	};

	const getRandomElement = <T>(array: T[]): T => array[Math.floor(Math.random() * array.length)];

	const getRandomString = (prefix: string, length: number): string =>
		prefix +
		Math.random()
			.toString(36)
			.substring(2, length + 2)
			.toUpperCase();

	const getRandomPhoneNumber = (): number => parseInt("555" + getRandomInt(1000000, 9999999).toString());

	const getRandomZip = (): number => getRandomInt(10000, 99999);

	const firstNames = ["Sample John", "Sample Jane", "Sample Robert", "Sample Maria", "Sample Michael", "Sample Sarah", "Sample David", "Sample Lisa", "Sample James", "Sample Ashley"];
	const lastNames = ["Sample Anderson", "Sample Johnson", "Sample Williams", "Sample Brown", "Sample Davis", "Sample Miller", "Sample Wilson", "Sample Moore", "Sample Taylor", "Sample Thomas"];
	const sexes = ["M", "F"];
	const heights = ["5'4\"", "5'5\"", "5'6\"", "5'7\"", "5'8\"", "5'9\"", "5'10\"", "5'11\"", "6'0\"", "6'1\"", "6'2\""];
	const hairColors = ["Brown", "Black", "Blonde", "Red", "Gray", "Auburn", "Sandy"];
	const eyeColors = ["Blue", "Brown", "Green", "Hazel", "Gray", "Amber"];
	const states = ["TX", "CA", "FL", "NY", "IL", "PA", "OH", "GA", "NC", "MI"];
	const cities = ["Sample City", "Sample Town", "Sample Heights", "Sample Valley", "Sample Springs", "Sample Park"];
	const streets = ["Sample Street", "Sample Avenue", "Sample Road", "Sample Drive", "Sample Lane", "Sample Boulevard"];
	const licenseClasses = ["Class C", "Class A", "Class B", "Class M", "Class A CDL", "Class B CDL", "Class DJ"];
	const licenseStatuses = ["Valid", "Expired", "Suspended", "Revoked", "Restricted"];
	const restrictions = ["None", "B - Corrective Lenses", "E - No Manual Transmission", "P - No Passengers", "K - CDL Intrastate Only"];

	const violationCodes = ["22349A", "22450A", "22348B", "316.192", "316.183", "316.193", "545.351", "VTL 1180D", "VTL 1110A"];
	const violationDescriptions = ["Speeding 1-15 mph over limit", "Speeding 16-25 mph over limit", "Speeding 26+ mph over limit", "Failure to stop at stop sign", "Failure to yield right of way", "Following too closely", "Reckless driving", "Improper lane change", "Failure to obey traffic control device", "Driving under the influence"];

	const accidentCodes = ["A08", "A12", "A20", "A21", "A22", "A23", "A24", "A25"];
	const accidentDescriptions = ["Ran off road - right", "Ran off road - left", "Struck fixed object", "Struck parked vehicle", "Rear-end collision", "Side-swipe collision", "Head-on collision", "Improper backing"];

	const crimeOffenses = ["316.193", "316.194", "322.34", "316.027", "316.061"];
	const crimeDescriptions = ["Driving under the influence - first offense", "Driving under the influence - second offense", "Driving while license suspended", "Leaving scene of accident", "Hit and run - property damage"];

	const withdrawalTypes = ["Suspension", "Revocation", "Cancellation", "Disqualification"];
	const withdrawalReasons = ["Point Accumulation", "DUI Conviction", "Failure to Pay Fines", "Medical Condition", "Court Order", "Administrative Action"];

	const medicalConditions = ["None", "Corrective Lenses Required", "Hearing Aid Required", "Diabetes - Insulin Dependent", "DOT Physical Current", "Prosthetic Aid", "Automatic Transmission Only"];

	const currentYear = new Date().getFullYear();
	const birthYear = getRandomInt(1950, 2006);
	const issueYear = Math.max(birthYear + 16, getRandomInt(2010, currentYear));
	const expirationYear = issueYear + getRandomInt(4, 8);

	const firstName = getRandomElement(firstNames);
	const lastName = getRandomElement(lastNames);
	const state = getRandomElement(states);

	const numViolations = getRandomInt(0, 5);
	const numWithdrawals = getRandomInt(0, 2);
	const numAccidents = getRandomInt(0, 3);
	const numCrimes = getRandomInt(0, 2);

	const violations: MVRViolation[] = [];
	for (let i = 0; i < numViolations; i++) {
		const violationDate = getRandomDate(2020, currentYear);
		const convictionDate = new Date(violationDate);
		convictionDate.setDate(convictionDate.getDate() + getRandomInt(30, 90));

		violations.push({
			violation_date: violationDate,
			conviction_date: convictionDate.toISOString().split("T")[0],
			location: `${getRandomElement(cities)}, ${state}`,
			points_assessed: getRandomInt(1, 6),
			violation_code: getRandomElement(violationCodes),
			description: getRandomElement(violationDescriptions),
		});
	}

	const withdrawals: MVRWithdrawal[] = [];
	for (let i = 0; i < numWithdrawals; i++) {
		const effectiveDate = getRandomDate(2020, currentYear);
		const eligibilityDate = new Date(effectiveDate);
		eligibilityDate.setMonth(eligibilityDate.getMonth() + getRandomInt(3, 12));

		withdrawals.push({
			effective_date: effectiveDate,
			eligibility_date: eligibilityDate.toISOString().split("T")[0],
			action_type: getRandomElement(withdrawalTypes),
			reason: getRandomElement(withdrawalReasons),
		});
	}

	const accidents: MVRAccident[] = [];
	for (let i = 0; i < numAccidents; i++) {
		accidents.push({
			accident_date: getRandomDate(2020, currentYear),
			location: `${getRandomElement(streets)}, ${state}`,
			acd_code: getRandomElement(accidentCodes),
			description: getRandomElement(accidentDescriptions),
		});
	}

	const crimes: MVRCrime[] = [];
	for (let i = 0; i < numCrimes; i++) {
		const crimeDate = getRandomDate(2020, currentYear);
		const convictionDate = new Date(crimeDate);
		convictionDate.setDate(convictionDate.getDate() + getRandomInt(60, 180));

		crimes.push({
			crime_date: crimeDate,
			conviction_date: convictionDate.toISOString().split("T")[0],
			offense_code: getRandomElement(crimeOffenses),
			description: getRandomElement(crimeDescriptions),
		});
	}

	const totalPoints = violations.reduce((sum, v) => sum + (v.points_assessed || 0), 0);

	return {
		drivers_license_number: driversLicenseNumber,
		full_legal_name: `${firstName} ${lastName}`,
		birthdate: getRandomDate(birthYear, birthYear),
		weight: getRandomInt(120, 300).toString(),
		sex: getRandomElement(sexes),
		height: getRandomElement(heights),
		hair_color: getRandomElement(hairColors),
		eye_color: getRandomElement(eyeColors),
		medical_information: getRandomElement(medicalConditions),
		address: `${getRandomInt(100, 9999)} ${getRandomElement(streets)}`,
		city: getRandomElement(cities),
		issued_state_code: state,
		zip: getRandomZip(),
		phone_number: getRandomPhoneNumber(),
		email: `${firstName.toLowerCase().replace("sample ", "")}.${lastName.toLowerCase().replace("sample ", "")}@example.com`,

		claim_number: getRandomString("CLM-", 12),
		order_id: getRandomString("ORD-", 10),
		order_date: getRandomDate(currentYear - 1, currentYear),
		report_date: getRandomDate(currentYear - 1, currentYear),
		reference_number: getRandomString("REF-", 10),
		system_use: getRandomElement(["Employment Screening", "Insurance Review", "Court Ordered", "DOT Compliance", "Background Check"]),
		mvr_type: getRandomElement(["Standard", "Comprehensive", "Commercial", "Complete History"]),
		state_code: state,
		purpose: getRandomElement(["Background Check", "Rate Determination", "Legal Proceeding", "Employment Verification", "Insurance Application"]),
		time_frame: getRandomElement(["3 Years", "5 Years", "7 Years", "10 Years"]),
		is_certified: Math.random() > 0.3,
		total_points: totalPoints,

		license_class: getRandomElement(licenseClasses),
		issue_date: getRandomDate(issueYear, issueYear),
		expiration_date: getRandomDate(expirationYear, expirationYear),
		status: getRandomElement(licenseStatuses),
		restrictions: getRandomElement(restrictions),

		violations: violations.sort((a, b) => new Date(b.violation_date).getTime() - new Date(a.violation_date).getTime()),
		withdrawals: withdrawals.sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime()),
		accidents: accidents.sort((a, b) => new Date(b.accident_date).getTime() - new Date(a.accident_date).getTime()),
		crimes: crimes.sort((a, b) => new Date(b.crime_date).getTime() - new Date(a.crime_date).getTime()),
	};
}

 function generateMultipleSampleMVRData(count: number, licensePrefix: string = "D"): MVRData[] {
	const records: MVRData[] = [];

	for (let i = 0; i < count; i++) {
		const licenseNumber = `${licensePrefix}${Math.random().toString().substring(2, 12)}`;
		records.push(generateSampleMVRData(licenseNumber));
	}

	return records;
}

 function generateCleanSampleMVRData(driversLicenseNumber: string): MVRData {
	const data = generateSampleMVRData(driversLicenseNumber);

	data.violations = [];
	data.withdrawals = [];
	data.accidents = [];
	data.crimes = [];
	data.total_points = 0;
	data.status = "Valid";
	data.restrictions = "None";
	data.medical_information = "None";

	return data;
}

 function generateHighRiskSampleMVRData(driversLicenseNumber: string): MVRData {
	const data = generateSampleMVRData(driversLicenseNumber);

	data.status = Math.random() > 0.5 ? "Suspended" : "Valid";

	if (data.violations!.length === 0) {
		data.violations = [
			{
				violation_date: "2023-08-15",
				conviction_date: "2023-09-20",
				location: "Sample City, TX",
				points_assessed: 4,
				violation_code: "22348B",
				description: "Speeding 26+ mph over limit",
			},
		];
		data.total_points = 4;
	}

	return data;
}

