'''
file that holds data objects, such as key words, enums, tec.
'''
import enum 


# size range for company 
class company_size_range(enum.StrEnum):
    ONE_TO_FIFTY="1_50"
    FIFTY_TO_TWO_HUNDRED="51_200"
    TWO_HUNDRED_TO_FIVE_HUNDRED= "201_500"
    TOUSAND="501_1000"
    FIVE_THOUSAND="1001_5000"
    TEN_THOUSAND= "5001_10000"
    LARGE_THOUSAND= "10000_"

class company_role(enum.StrEnum): 
    '''
    different possible roles for company memebership table 
    '''
    owner= "owner"
    admin= "admin"
    recruiter= "recruiter"

class profile_status(enum.StrEnum):
    '''
    different possible status for a profile to be in
    '''
    active= "active"
    invited= "invited"
    disabled = "disabled"