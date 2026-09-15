'''
file that holds data objects, such as key words, enums, tec.
'''
import enum 


# size range for company 
class company_size_range(str,enum.StrEnum):
    ONE_TO_FIFTY="1_50"
    FIFTY_TO_TWO_HUNDRED="51_200"
    TWO_HUNDRED_TO_FIVE_HUNDRED= "201_500"
    TOUSAND="501_1000"
    FIVE_THOUSAND="1001_5000"
    TEN_THOUSAND= "5001_10000"
    LARGE_THOUSAND= "10000_"

class company_role(str, enum.StrEnum): 
    '''
    different possible roles for company memebership table 
    '''
    COMPANY_OWNER= "Owner"
    COMPANY_ADMIN= "Admin"
    COMPANY_RECRUITER= "Recruiter"

class profile_status(str, enum.StrEnum):
    '''
    different possible status for a profile to be in
    '''
    ACTIVE= "Active"
    INVITED= "Invited"
    DISABLED = "Disabled"