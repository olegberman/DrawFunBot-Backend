type TGUser = {
	id: number;
	first_name?: string;
	last_name?: string;
	username?: string;
	language_code: string;
	is_premium: boolean;
	allows_write_to_pm: boolean;
};

const formatName = (user: TGUser): string => {
	if (user.username) {
		return `@${user.username}`;
	}
	if (user.first_name) {
		return user.first_name;
	}
	if (user.id) {
		return `ID${user.id}`;
	}
	return '';
};

export default formatName;
